"use server";

import { revalidatePath } from "next/cache";
import type { PaymentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import { computePaymentState, type PaymentLike } from "@/lib/payments";
import { toDecimal } from "@/lib/pricing";
import { formatNaira } from "@/lib/format";
import { salePaymentSchema } from "@/lib/validations/sale";
import { saleReturnSchema } from "@/lib/validations/sale-return";
import {
  applyStockDeltas,
  DocumentChangedError,
  documentOrderData,
  invalid,
  loadDocument,
  revalidateDocumentPaths,
  toFieldErrors,
} from "../../purchases/document-actions";
import type { PurchaseActionState } from "../../purchases/types";
import type { SalePaymentActionState, SalePaymentsView } from "../actions";
import { lockSaleRow } from "./returnable";
import {
  assertReturnable,
  LIST_PATH,
  OverReturnError,
  overReturnMessage,
  restaurantSaleRefusal,
  revalidateSaleReturnPaths,
  saleReturnItemsData,
  saveNewSaleReturn,
} from "./save-return";

const requireManageSaleReturns = () => requirePermission(PERMISSIONS.MANAGE_SALE_RETURN);

export async function createSaleReturn(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }
  const saleId = input && typeof input === "object" && "saleId" in input && typeof input.saleId === "string" ? input.saleId : null;
  const restaurant = await restaurantSaleRefusal(saleId);
  if (restaurant) return { ok: false, error: restaurant };
  return saveNewSaleReturn(input, authCheck.userId);
}

// ------------------------------------------------------------------- Edit

class RefundsExceedTotalError extends Error {
  constructor(
    public readonly paid: string,
    public readonly grandTotal: string,
  ) {
    super("Refunds exceed the new total.");
  }
}

export async function updateSaleReturn(id: string, input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the return and its sale server-side; the id is the only thing
  // taken from the client (the page binds it). The sale, customer and
  // warehouse stay the return's own — any saleId the form sends is ignored.
  const current = await prisma.saleReturn.findFirst({
    where: { id, deletedAt: null },
    select: {
      customerId: true,
      warehouseId: true,
      sale: { select: { id: true, reference: true, items: { select: { id: true, productId: true } } } },
    },
  });
  if (!current) {
    return { ok: false, error: "Sale return not found. It may have been deleted." };
  }
  const { sale } = current;
  if (!sale) {
    return { ok: false, error: "This return isn't linked to a sale, so it can't be edited." };
  }
  const restaurant = await restaurantSaleRefusal(sale.id);
  if (restaurant) return { ok: false, error: restaurant };

  const parsed = saleReturnSchema.safeParse({ ...(input as object), saleId: sale.id });
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  const saleItemById = new Map(sale.items.map((item) => [item.id, item]));
  if (parsed.data.items.some((item) => !saleItemById.has(item.saleItemId))) {
    return invalid({ items: [`One of the lines isn't on ${sale.reference}. Reload the page and try again.`] });
  }

  // Products from the sale lines; lines and totals recomputed with
  // lib/pricing.ts, as on create.
  const loaded = await loadDocument(
    {
      ...parsed.data,
      warehouseId: current.warehouseId,
      items: parsed.data.items.map((item) => ({ ...item, productId: saleItemById.get(item.saleItemId)!.productId })),
    },
    current.customerId,
    {
      party: "customer",
      existing: {
        warehouseId: current.warehouseId,
        partyId: current.customerId,
        productIds: sale.items.map((item) => item.productId),
      },
    },
  );
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order, productById } = loaded;

  let previousProductIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // First statement: lock the sale (see lockSaleRow), so the returnable
      // check can't race another return of it.
      if (!(await lockSaleRow(tx, sale.id))) throw new DocumentChangedError();

      // The "before" state, read inside the transaction.
      const before = await tx.saleReturn.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
          payments: ACTIVE_REFUNDS,
        },
      });
      if (!before) throw new DocumentChangedError();

      // Not more than the sale still has returnable, counting every OTHER
      // active return (this return's old quantities are free again).
      await assertReturnable(tx, sale, data.items, productById, id);

      // REFUNDS — existing refunds stay as they are; paid / due / status are
      // re-derived against the NEW grand total. A total cut below what's
      // already been refunded is refused (remove a refund first).
      const refundState = computePaymentState(order.grandTotal, before.payments.map(toPaymentLike));
      if (refundState.paid.greaterThan(order.grandTotal)) {
        throw new RefundsExceedTotalError(refundState.paid.toFixed(2), order.grandTotal.toFixed(2));
      }

      // Header update only if the return is unchanged since `before` (also
      // row-locks it).
      const { count } = await tx.saleReturn.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: {
          ...documentOrderData({ ...data, warehouseId: before.warehouseId }, order),
          paid: refundState.paid.toFixed(2),
          due: refundState.due.toFixed(2),
          paymentStatus: refundState.paymentStatus,
        },
      });
      if (count === 0) throw new DocumentChangedError();

      // STOCK RECONCILIATION — by the difference only (lib/purchase-stock.ts,
      // direction "in"; Received and Completed both hold stock):
      //   Pending → Received/Completed adds every line; back to Pending takes
      //   it out again; a qty change on a stock-holding return moves only the
      //   difference. Decreases go through decreaseStock, which refuses to go
      //   below zero (e.g. the returned goods were sold again) — that throws
      //   InsufficientStockError and rolls the whole edit back.
      const after = { status: data.status, warehouseId: before.warehouseId, items: data.items };
      await applyStockDeltas(tx, purchaseStockDeltas(before, after, "in"), undefined);

      // Nothing references SaleReturnItem ids, so lines are replaced.
      await tx.saleReturnItem.deleteMany({ where: { returnId: id } });
      await tx.saleReturnItem.createMany({
        data: saleReturnItemsData(
          lines,
          data.items.map((item) => item.saleItemId),
        ).map((item) => ({ ...item, returnId: id })),
      });

      previousProductIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof OverReturnError) return { ok: false, error: overReturnMessage(error) };
    if (error instanceof RefundsExceedTotalError) {
      return {
        ok: false,
        error: `Refunds (${formatNaira(error.paid)}) exceed new total (${formatNaira(error.grandTotal)}) — remove a refund first.`,
      };
    }
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't save — not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, this change takes out ${error.requested}).`,
      };
    }
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale return was changed or deleted by someone else. Reload the page and try again." };
    }
    throw error;
  }

  revalidateSaleReturnPaths(sale.id, [...previousProductIds, ...data.items.map((item) => item.productId)], id);
  return { ok: true, id, reference };
}

// ----------------------------------------------------------------- Delete

// Soft delete.
//
// A Received/Completed return put stock back into its warehouse, so deleting
// it takes that stock OUT again — purchaseStockDeltas(before, null, "in")
// yields only decreases. Each goes through decreaseStock, which refuses to
// go below zero: if the returned goods have since been sold or moved, the
// delete is refused and nothing changes. Pending moved no stock, so deleting
// it moves none. The return's refunds are soft-deleted with it, and its
// quantities become returnable on the sale again.
export async function deleteSaleReturn(id: string): Promise<PurchaseActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const target = await prisma.saleReturn.findFirst({ where: { id, deletedAt: null }, select: { saleId: true } });
  const restaurant = await restaurantSaleRefusal(target?.saleId);
  if (restaurant) return { ok: false, error: restaurant };

  let productIds: string[] = [];
  let reference = "";
  let saleId: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the return server-side; only its id came from the client.
      const before = await tx.saleReturn.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          saleId: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new DocumentChangedError();

      // Conditional on the state just read, and row-locks the return, so a
      // concurrent edit/delete can't take the stock out a second time.
      const now = new Date();
      const { count } = await tx.saleReturn.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: now },
      });
      if (count === 0) throw new DocumentChangedError();

      await tx.saleReturnPayment.updateMany({ where: { saleReturnId: id, deletedAt: null }, data: { deletedAt: now } });

      await applyStockDeltas(tx, purchaseStockDeltas(before, null, "in"), undefined);

      productIds = before.items.map((item) => item.productId);
      reference = before.reference;
      saleId = before.saleId;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't delete — ${error.productName} stock in ${error.warehouseName} is lower than this return added.`,
      };
    }
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale return was changed or already deleted. Reload the page and try again." };
    }
    throw error;
  }

  if (saleId) {
    revalidateSaleReturnPaths(saleId, productIds, id);
  } else {
    revalidateDocumentPaths(LIST_PATH, productIds, id);
  }
  return { ok: true, id, reference };
}

// ----------------------------------------------------------------- Refunds
//
// Money paid back to the customer for a return (SaleReturnPayment). Same
// rules as sale payments: the return's paid / due / paymentStatus are
// recomputed with computePaymentState after every change, and a refund can't
// be more than what's still due. Shown in the shared payments modal.

class RefundTooLargeError extends Error {
  constructor(public readonly due: string) {
    super("Refund is more than the refund due.");
  }
}

const ACTIVE_REFUNDS = {
  where: { deletedAt: null },
  select: { id: true, amount: true, paymentType: true, date: true, notes: true, createdAt: true },
  orderBy: [{ date: "asc" as const }, { createdAt: "asc" as const }],
};

const toPaymentLike = (refund: { amount: Prisma.Decimal; paymentType: PaymentType; date: Date; createdAt: Date }) => ({
  amount: refund.amount.toString(),
  paymentType: refund.paymentType,
  date: refund.date,
  createdAt: refund.createdAt,
});

// Read-only (session only). Return header figures + its active refunds.
export async function getSaleReturnRefunds(returnId: string): Promise<SalePaymentsView | null> {
  if (!(await can(PERMISSIONS.MANAGE_SALE_RETURN))) return null;

  const saleReturn = await prisma.saleReturn.findFirst({
    where: { id: returnId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      grandTotal: true,
      paid: true,
      due: true,
      paymentStatus: true,
      payments: ACTIVE_REFUNDS,
    },
  });
  if (!saleReturn) return null;

  return {
    documentId: saleReturn.id,
    reference: saleReturn.reference,
    grandTotal: saleReturn.grandTotal.toFixed(2),
    paid: saleReturn.paid.toFixed(2),
    due: saleReturn.due.toFixed(2),
    paymentStatus: saleReturn.paymentStatus,
    payments: saleReturn.payments.map((refund) => ({
      id: refund.id,
      date: refund.date.toISOString().slice(0, 10),
      amount: refund.amount.toFixed(2),
      paymentType: refund.paymentType,
      notes: refund.notes,
    })),
  };
}

// Stores paid / due / paymentStatus from the active refunds. Conditional on
// `updatedAt` read in this transaction (and row-locks the return), so two
// concurrent refunds can't both pass the "not more than due" check.
async function storeRefundState(
  tx: Prisma.TransactionClient,
  saleReturn: { id: string; grandTotal: Prisma.Decimal; updatedAt: Date },
  refunds: PaymentLike[],
) {
  const state = computePaymentState(saleReturn.grandTotal.toString(), refunds);
  const { count } = await tx.saleReturn.updateMany({
    where: { id: saleReturn.id, deletedAt: null, updatedAt: saleReturn.updatedAt },
    data: { paid: state.paid.toFixed(2), due: state.due.toFixed(2), paymentStatus: state.paymentStatus },
  });
  if (count === 0) throw new DocumentChangedError();
}

function revalidateRefundPaths(returnId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${returnId}`);
}

export async function addSaleReturnRefund(returnId: string, input: unknown): Promise<SalePaymentActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = salePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors as SalePaymentActionState["fieldErrors"],
    };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the return and its active refunds server-side.
      const saleReturn = await tx.saleReturn.findFirst({
        where: { id: returnId, deletedAt: null },
        select: { id: true, grandTotal: true, updatedAt: true, payments: ACTIVE_REFUNDS },
      });
      if (!saleReturn) throw new DocumentChangedError();

      const existing = saleReturn.payments.map(toPaymentLike);
      const { due } = computePaymentState(saleReturn.grandTotal.toString(), existing);
      if (toDecimal(data.amount).greaterThan(due)) {
        throw new RefundTooLargeError(due.toFixed(2));
      }

      const created = await tx.saleReturnPayment.create({
        data: {
          saleReturnId: saleReturn.id,
          amount: toDecimal(data.amount).toFixed(2),
          paymentType: data.paymentType,
          date: data.date,
          notes: data.notes ?? null,
          createdById: authCheck.userId,
        },
        select: { amount: true, paymentType: true, date: true, createdAt: true },
      });

      await storeRefundState(tx, saleReturn, [...existing, toPaymentLike(created)]);
    });
  } catch (error) {
    if (error instanceof RefundTooLargeError) {
      return {
        ok: false,
        error: "Please fix the errors below.",
        fieldErrors: { amount: [`Amount can't be more than the refund due (${formatNaira(error.due)}).`] },
      };
    }
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale return was changed or deleted. Reload and try again." };
    }
    throw error;
  }

  revalidateRefundPaths(returnId);
  return { ok: true };
}

// Soft delete; the return's figures are recomputed from what remains.
export async function deleteSaleReturnRefund(refundId: string): Promise<SalePaymentActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let returnId = "";
  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the refund (and that its return is live) server-side.
      const refund = await tx.saleReturnPayment.findFirst({
        where: { id: refundId, deletedAt: null, saleReturn: { deletedAt: null } },
        select: { saleReturnId: true },
      });
      if (!refund) throw new DocumentChangedError();
      returnId = refund.saleReturnId;

      const saleReturn = await tx.saleReturn.findFirst({
        where: { id: refund.saleReturnId, deletedAt: null },
        select: { id: true, grandTotal: true, updatedAt: true, payments: ACTIVE_REFUNDS },
      });
      if (!saleReturn) throw new DocumentChangedError();

      const { count } = await tx.saleReturnPayment.updateMany({
        where: { id: refundId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DocumentChangedError();

      await storeRefundState(
        tx,
        saleReturn,
        saleReturn.payments.filter((p) => p.id !== refundId).map(toPaymentLike),
      );
    });
  } catch (error) {
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This refund was already removed or its return changed. Reload and try again." };
    }
    throw error;
  }

  revalidateRefundPaths(returnId);
  return { ok: true };
}
