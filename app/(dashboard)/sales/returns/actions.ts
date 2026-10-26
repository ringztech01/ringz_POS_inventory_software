"use server";

import { revalidatePath } from "next/cache";
import type { PaymentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { generateReference } from "@/lib/reference";
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
  documentItemsData,
  documentOrderData,
  invalid,
  isReferenceCollision,
  loadDocument,
  MAX_REFERENCE_ATTEMPTS,
  revalidateDocumentPaths,
  toFieldErrors,
  type Loaded,
} from "../../purchases/document-actions";
import type { PurchaseActionState } from "../../purchases/types";
import type { SalePaymentActionState, SalePaymentsView } from "../actions";
import { lockSaleRow, returnedBySaleItem } from "./returnable";

const LIST_PATH = "/sales/returns";
const requireManageSaleReturns = () => requirePermission(PERMISSIONS.MANAGE_SALE_RETURN);

// Thrown inside the transaction when a line would take back more than is
// still returnable on the sale (sold − already returned by active returns).
class OverReturnError extends Error {
  constructor(
    public readonly quantity: number,
    public readonly productName: string,
    public readonly returnable: number,
    public readonly saleReference: string,
  ) {
    super("Return exceeds the returnable quantity.");
  }
}

const overReturnMessage = (error: OverReturnError) =>
  `Can't return ${error.quantity} × ${error.productName} — only ${error.returnable} left returnable on ${error.saleReference}.`;

// Inside the transaction, AFTER lockSaleRow: every line must fit in
//   returnable = sold now − returned by the sale's other active returns.
// Sold quantities are re-read too (the sale may have been edited since the
// form loaded). `excludeReturnId`: on edit, the return's own old quantities
// are available again.
async function assertReturnable(
  tx: Prisma.TransactionClient,
  sale: { id: string; reference: string },
  items: { saleItemId: string; productId: string; quantity: number }[],
  productById: Map<string, { name: string }>,
  excludeReturnId?: string,
) {
  const soldNow = new Map(
    (await tx.saleItem.findMany({ where: { saleId: sale.id }, select: { id: true, quantity: true } })).map(
      (item) => [item.id, item.quantity],
    ),
  );
  const returned = await returnedBySaleItem(tx, sale.id, excludeReturnId);
  for (const item of items) {
    const sold = soldNow.get(item.saleItemId);
    if (sold === undefined) throw new DocumentChangedError();
    const returnable = sold - (returned.get(item.saleItemId) ?? 0);
    if (item.quantity > returnable) {
      throw new OverReturnError(
        item.quantity,
        productById.get(item.productId)?.name ?? "this product",
        Math.max(returnable, 0),
        sale.reference,
      );
    }
  }
}

// The shared line rows use purchase column names; SaleReturnItem calls them
// netUnitPrice / saleUnit, and also links each row to its sale line.
function saleReturnItemsData(lines: Pick<Loaded, "lines">["lines"], saleItemIds: string[]) {
  return documentItemsData(lines).map(({ netUnitCost, purchaseUnit, ...rest }, index) => ({
    ...rest,
    netUnitPrice: netUnitCost,
    saleUnit: purchaseUnit,
    saleItemId: saleItemIds[index],
  }));
}

function revalidateSaleReturnPaths(saleId: string, productIds: string[], returnId?: string) {
  revalidateDocumentPaths(LIST_PATH, productIds, returnId);
  revalidatePath("/sales");
  revalidatePath(`/sales/${saleId}`);
}

export async function createSaleReturn(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageSaleReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = saleReturnSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  // Re-read the sale server-side. Customer and warehouse come from it — the
  // form never sends them — and every line must be one of its lines.
  const sale = await prisma.sale.findFirst({
    where: { id: parsed.data.saleId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      customerId: true,
      warehouseId: true,
      items: { select: { id: true, productId: true, quantity: true } },
    },
  });
  if (!sale) {
    return { ok: false, error: "Sale not found. It may have been deleted." };
  }

  const saleItemById = new Map(sale.items.map((item) => [item.id, item]));
  if (parsed.data.items.some((item) => !saleItemById.has(item.saleItemId))) {
    return invalid({ items: [`One of the lines isn't on ${sale.reference}. Reload the page and try again.`] });
  }

  // Each line's product is the sale line's product, whatever the client sent.
  // The sale's warehouse/customer/products stay valid even if soft-deleted
  // since. Lines and the grand total are recomputed with lib/pricing.ts.
  const loaded = await loadDocument(
    {
      ...parsed.data,
      warehouseId: sale.warehouseId,
      items: parsed.data.items.map((item) => ({ ...item, productId: saleItemById.get(item.saleItemId)!.productId })),
    },
    sale.customerId,
    {
      party: "customer",
      existing: {
        warehouseId: sale.warehouseId,
        partyId: sale.customerId,
        productIds: sale.items.map((item) => item.productId),
      },
    },
  );
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order, productById } = loaded;

  // Nothing refunded yet: paid 0, due = grand total, Unpaid. Refunds are
  // recorded later from the return's page (SaleReturnPayment).
  const refundState = computePaymentState(order.grandTotal, []);

  // One transaction: lock the sale, re-check returnable, SR_ reference, the
  // return + its lines, and — only when Received or Completed — the stock
  // increment for every line in the sale's warehouse (increaseStock upserts
  // ProductStock). Pending moves no stock.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // First statement: serialises returns of this sale (and sale
        // edits/deletes), so the returnable check below sees every return
        // committed before us.
        if (!(await lockSaleRow(tx, sale.id))) throw new DocumentChangedError();

        await assertReturnable(tx, sale, data.items, productById);

        const saleReturn = await tx.saleReturn.create({
          data: {
            ...documentOrderData(data, order),
            saleId: sale.id,
            customerId: sale.customerId,
            reference: generateReference("SR"),
            // Refund figures — derived, never typed in.
            paid: refundState.paid.toFixed(2),
            due: refundState.due.toFixed(2),
            paymentStatus: refundState.paymentStatus,
            createdById: authCheck.userId,
            items: {
              create: saleReturnItemsData(
                lines,
                data.items.map((item) => item.saleItemId),
              ),
            },
          },
          select: { id: true, reference: true },
        });

        // A return brings stock back IN (direction "in"); Received and
        // Completed both hold it (lib/purchase-stock.ts).
        const after = { status: data.status, warehouseId: sale.warehouseId, items: data.items };
        await applyStockDeltas(tx, purchaseStockDeltas(null, after, "in"), undefined);

        return saleReturn;
      });

      revalidateSaleReturnPaths(
        sale.id,
        data.items.map((item) => item.productId),
      );
      return { ok: true, id: created.id, reference: created.reference };
    } catch (error) {
      if (error instanceof OverReturnError) return { ok: false, error: overReturnMessage(error) };
      if (error instanceof DocumentChangedError) {
        return { ok: false, error: "The sale was changed or deleted. Reload the page and try again." };
      }
      if (isReferenceCollision(error)) {
        if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
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
