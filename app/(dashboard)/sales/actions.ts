"use server";

import type { PaymentStatus, PaymentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import { toDecimal } from "@/lib/pricing";
import { computePaymentState, type PaymentLike } from "@/lib/payments";
import { formatNaira } from "@/lib/format";
import { salePaymentSchema, saleSchema } from "@/lib/validations/sale";
import {
  applyStockDeltas,
  DocumentChangedError,
  documentOrderData,
  invalid,
  loadDocument,
  revalidateDocumentPaths,
  toFieldErrors,
} from "../purchases/document-actions";
import { searchPurchaseProducts } from "../purchases/product-search";
import type { PurchaseActionState, PurchaseProductSearchResult } from "../purchases/types";
import { lockSaleRow, returnedBySaleItem } from "./returns/returnable";
import { saleItemsData, saveNewSale } from "./save-sale";

const LIST_PATH = "/sales";
const requireManageSales = () => requirePermission(PERMISSIONS.MANAGE_SALE);

export async function createSale(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageSales();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  return saveNewSale(input, authCheck.userId);
}

// ------------------------------------------------------------------- Edit

class PaymentsExceedTotalError extends Error {
  constructor(
    public readonly paid: string,
    public readonly grandTotal: string,
  ) {
    super("Payments exceed the new total.");
  }
}

// An edit that would undo part of a sale's active returns (message is the toast).
class ReturnedLineError extends Error {}

export async function updateSale(id: string, input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageSales();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the sale server-side; the id is the only thing taken from the
  // client (and the page binds it — the form never sends it).
  const current = await prisma.sale.findFirst({
    where: { id, deletedAt: null },
    select: { warehouseId: true, customerId: true, items: { select: { productId: true } } },
  });
  if (!current) {
    return { ok: false, error: "Sale not found. It may have been deleted." };
  }

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  // Totals recomputed server-side with lib/pricing.ts, as on create. Edit
  // never touches SalePayment rows (any paidAmount sent is ignored — payments
  // go through Show Payments).
  const loaded = await loadDocument(parsed.data, parsed.data.customerId, {
    party: "customer",
    priceFallback: true,
    existing: {
      warehouseId: current.warehouseId,
      partyId: current.customerId,
      productIds: current.items.map((item) => item.productId),
    },
  });
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order } = loaded;

  let previousProductIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // First statement: lock the sale so no return of it can be saved while
      // this edit checks (and changes) what's returnable.
      if (!(await lockSaleRow(tx, id))) throw new DocumentChangedError();

      // The "before" state, read inside the transaction.
      const before = await tx.sale.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { id: true, productId: true, quantity: true, product: { select: { name: true } } } },
          payments: ACTIVE_PAYMENTS,
        },
      });
      if (!before) throw new DocumentChangedError();

      // RETURNS — sale lines are stable: returns point at them (saleItemId).
      // A line something was returned against can't be removed or cut below
      // its returned quantity; and the warehouse is fixed once there are
      // returns (their stock went back into it).
      const returned = await returnedBySaleItem(tx, id);
      if (returned.size > 0 && data.warehouseId !== before.warehouseId) {
        throw new ReturnedLineError("Can't change the warehouse — this sale has returns.");
      }
      const newQuantity = new Map(data.items.map((item) => [item.productId, item.quantity]));
      for (const line of before.items) {
        const returnedQty = returned.get(line.id) ?? 0;
        if (returnedQty === 0) continue;
        const qty = newQuantity.get(line.productId);
        if (qty === undefined) {
          throw new ReturnedLineError(`Can't remove ${line.product.name} — ${returnedQty} already returned on ${before.reference}.`);
        }
        if (qty < returnedQty) {
          throw new ReturnedLineError(`Can't reduce ${line.product.name} below ${returnedQty} — that many are already returned on ${before.reference}.`);
        }
      }

      // PAYMENTS — existing payments stay as they are; paid / due / status /
      // type are re-derived against the NEW grand total. A total cut below
      // what's already been paid is refused (the user removes a payment
      // first, in Show Payments).
      const payments = before.payments.map(toPaymentLike);
      const paymentState = computePaymentState(order.grandTotal, payments);
      if (paymentState.paid.greaterThan(order.grandTotal)) {
        throw new PaymentsExceedTotalError(paymentState.paid.toFixed(2), order.grandTotal.toFixed(2));
      }

      // Header update only if the sale is unchanged since `before`; the UPDATE
      // also row-locks it, so concurrent edits can't both reconcile stock
      // against the same "before".
      const { count } = await tx.sale.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: {
          ...documentOrderData(data, order),
          customerId: data.customerId,
          paid: paymentState.paid.toFixed(2),
          due: paymentState.due.toFixed(2),
          paymentStatus: paymentState.paymentStatus,
          paymentType: paymentState.paymentType,
        },
      });
      if (count === 0) throw new DocumentChangedError();

      // STOCK RECONCILIATION — by the difference only, never by re-running
      // create's decrement (that would take the stock out a second time).
      //
      //   oldOut = old line qty per (product, warehouse) if the old status was
      //            Received, else 0
      //   newOut = the same for the new lines, status and warehouse
      //   stock change = −(newOut − oldOut)        (direction "out")
      //
      // So: Pending → Received decrements; Received → Pending restores; a
      // warehouse change restores the old warehouse and decrements the new
      // one; a qty change on a Received sale moves only the difference.
      // Decrements go through decreaseStock, which refuses to go below zero —
      // InsufficientStockError rolls the whole edit back. Same rule (and
      // tests) as Purchase Returns: lib/purchase-stock.ts.
      const after = { status: data.status, warehouseId: data.warehouseId, items: data.items };
      await applyStockDeltas(tx, purchaseStockDeltas(before, after, "out"), undefined);

      // Lines are matched by product and updated in place (keeping their ids
      // for returns); removed products' lines — never returned, checked above
      // — are deleted; new products get new lines.
      const lineIdByProduct = new Map(before.items.map((line) => [line.productId, line.id]));
      const removed = before.items.filter((line) => !newQuantity.has(line.productId)).map((line) => line.id);
      if (removed.length > 0) await tx.saleItem.deleteMany({ where: { id: { in: removed } } });
      const rows = saleItemsData(lines);
      for (const row of rows) {
        const lineId = lineIdByProduct.get(row.productId);
        if (lineId) await tx.saleItem.update({ where: { id: lineId }, data: row });
      }
      const added = rows.filter((row) => !lineIdByProduct.has(row.productId));
      if (added.length > 0) await tx.saleItem.createMany({ data: added.map((row) => ({ ...row, saleId: id })) });

      previousProductIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof PaymentsExceedTotalError) {
      return {
        ok: false,
        error: `Payments (${formatNaira(error.paid)}) exceed new total (${formatNaira(error.grandTotal)}) — remove a payment first.`,
      };
    }
    if (error instanceof ReturnedLineError) return { ok: false, error: error.message };
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't save — not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, this change takes out ${error.requested}).`,
      };
    }
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale was changed or deleted by someone else. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, [...previousProductIds, ...data.items.map((item) => item.productId)], id);
  return { ok: true, id, reference };
}

// ----------------------------------------------------------------- Delete

// Soft delete.
//
// Deleting a sale returns the goods to inventory, so it ADDS the sold stock
// back to its warehouse (only if it was Received — Pending/Ordered never
// moved stock). That's the same direction as deleting a purchase return, and
// the opposite of deleting a purchase (which removes the stock it added).
// Same reconciliation as an edit with nothing after it:
// purchaseStockDeltas(before, null, "out") yields only increases, which can't
// drive a balance negative. The sale's payments are soft-deleted with it.
export async function deleteSale(id: string): Promise<PurchaseActionState> {
  const authCheck = await requireManageSales();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let productIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockSaleRow(tx, id))) throw new DocumentChangedError();

      // Re-read the sale server-side; only its id came from the client.
      const before = await tx.sale.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new DocumentChangedError();

      // Refused while any active sale return references this sale — deleting
      // would add the returned goods back a second time. Delete the returns
      // first. (Read after lockSaleRow, so no return can slip in meanwhile.)
      if (await tx.saleReturn.count({ where: { saleId: id, deletedAt: null } })) {
        throw new ReturnedLineError(`Can't delete ${before.reference} — it has sale returns. Delete those first.`);
      }

      // Conditional on the state just read, and row-locks the sale, so a
      // concurrent edit/delete can't add the stock back a second time.
      const now = new Date();
      const { count } = await tx.sale.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: now },
      });
      if (count === 0) throw new DocumentChangedError();

      await tx.salePayment.updateMany({ where: { saleId: id, deletedAt: null }, data: { deletedAt: now } });

      await applyStockDeltas(tx, purchaseStockDeltas(before, null, "out"), undefined);

      productIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof ReturnedLineError) return { ok: false, error: error.message };
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale was changed or already deleted. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, productIds, id);
  return { ok: true, id, reference };
}

// ---------------------------------------------------------------- Payments

export type SalePaymentRow = {
  id: string;
  // YYYY-MM-DD (stored at UTC midnight)
  date: string;
  amount: string;
  paymentType: PaymentType;
  notes: string | null;
};

export type SalePaymentsView = {
  // The sale (or, for refunds, the sale return).
  documentId: string;
  reference: string;
  grandTotal: string;
  paid: string;
  due: string;
  paymentStatus: PaymentStatus;
  payments: SalePaymentRow[];
};

export type SalePaymentFieldName = "amount" | "paymentType" | "date" | "notes";
export type SalePaymentActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<SalePaymentFieldName, string[]>>;
};

class PaymentTooLargeError extends Error {
  constructor(public readonly due: string) {
    super("Payment is more than the amount due.");
  }
}

const ACTIVE_PAYMENTS = {
  where: { deletedAt: null },
  select: { id: true, amount: true, paymentType: true, date: true, notes: true, createdAt: true },
  orderBy: [{ date: "asc" as const }, { createdAt: "asc" as const }],
};

// Read-only (session only). Sale header figures + its active payments.
export async function getSalePayments(saleId: string): Promise<SalePaymentsView | null> {
  if (!(await can(PERMISSIONS.MANAGE_SALE))) return null;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      grandTotal: true,
      paid: true,
      due: true,
      paymentStatus: true,
      payments: ACTIVE_PAYMENTS,
    },
  });
  if (!sale) return null;

  return {
    documentId: sale.id,
    reference: sale.reference,
    grandTotal: sale.grandTotal.toFixed(2),
    paid: sale.paid.toFixed(2),
    due: sale.due.toFixed(2),
    paymentStatus: sale.paymentStatus,
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      date: payment.date.toISOString().slice(0, 10),
      amount: payment.amount.toFixed(2),
      paymentType: payment.paymentType,
      notes: payment.notes,
    })),
  };
}

// Recomputes and stores the sale's paid / due / paymentStatus / paymentType
// from its active payments (computePaymentState). The update only applies if
// the sale is unchanged since `updatedAt` was read in this transaction — it
// also row-locks the sale, so two concurrent payment changes can't both
// pass the "not more than due" check and overpay it.
async function storePaymentState(
  tx: Prisma.TransactionClient,
  sale: { id: string; grandTotal: Prisma.Decimal; updatedAt: Date },
  payments: PaymentLike[],
) {
  const state = computePaymentState(sale.grandTotal.toString(), payments);
  const { count } = await tx.sale.updateMany({
    where: { id: sale.id, deletedAt: null, updatedAt: sale.updatedAt },
    data: {
      paid: state.paid.toFixed(2),
      due: state.due.toFixed(2),
      paymentStatus: state.paymentStatus,
      paymentType: state.paymentType,
    },
  });
  if (count === 0) throw new DocumentChangedError();
}

const toPaymentLike = (payment: { amount: Prisma.Decimal; paymentType: PaymentType; date: Date; createdAt: Date }) => ({
  amount: payment.amount.toString(),
  paymentType: payment.paymentType,
  date: payment.date,
  createdAt: payment.createdAt,
});

export async function addSalePayment(saleId: string, input: unknown): Promise<SalePaymentActionState> {
  const authCheck = await requireManageSales();
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
      // Re-read the sale and its active payments server-side.
      const sale = await tx.sale.findFirst({
        where: { id: saleId, deletedAt: null },
        select: { id: true, grandTotal: true, updatedAt: true, payments: ACTIVE_PAYMENTS },
      });
      if (!sale) throw new DocumentChangedError();

      const existing = sale.payments.map(toPaymentLike);
      const { due } = computePaymentState(sale.grandTotal.toString(), existing);
      if (toDecimal(data.amount).greaterThan(due)) {
        throw new PaymentTooLargeError(due.toFixed(2));
      }

      const created = await tx.salePayment.create({
        data: {
          saleId: sale.id,
          amount: toDecimal(data.amount).toFixed(2),
          paymentType: data.paymentType,
          date: data.date,
          notes: data.notes ?? null,
          createdById: authCheck.userId,
        },
        select: { amount: true, paymentType: true, date: true, createdAt: true },
      });

      await storePaymentState(tx, sale, [...existing, toPaymentLike(created)]);
    });
  } catch (error) {
    if (error instanceof PaymentTooLargeError) {
      return {
        ok: false,
        error: "Please fix the errors below.",
        fieldErrors: { amount: [`Amount can't be more than the amount due (${formatNaira(error.due)}).`] },
      };
    }
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This sale was changed or deleted. Reload and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, [], saleId);
  return { ok: true };
}

// Soft delete; the sale's figures are recomputed from what remains.
export async function deleteSalePayment(paymentId: string): Promise<SalePaymentActionState> {
  const authCheck = await requireManageSales();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let saleId = "";
  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the payment (and that its sale is live) server-side.
      const payment = await tx.salePayment.findFirst({
        where: { id: paymentId, deletedAt: null, sale: { deletedAt: null } },
        select: { saleId: true },
      });
      if (!payment) throw new DocumentChangedError();
      saleId = payment.saleId;

      const sale = await tx.sale.findFirst({
        where: { id: payment.saleId, deletedAt: null },
        select: { id: true, grandTotal: true, updatedAt: true, payments: ACTIVE_PAYMENTS },
      });
      if (!sale) throw new DocumentChangedError();

      const { count } = await tx.salePayment.updateMany({
        where: { id: paymentId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DocumentChangedError();

      await storePaymentState(
        tx,
        sale,
        sale.payments.filter((p) => p.id !== paymentId).map(toPaymentLike),
      );
    });
  } catch (error) {
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This payment was already removed or its sale changed. Reload and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, [], saleId);
  return { ok: true };
}

// Read-only, so only a session is required — Manage Sale is enforced on the
// mutations. Warehouse-scoped: only products with stock > 0 in the selected
// warehouse (you can only sell what you hold), with that stock shown.
export async function searchProductsForSale(
  warehouseId: string,
  query: string,
): Promise<PurchaseProductSearchResult[]> {
  if (!(await can(PERMISSIONS.MANAGE_SALE))) {
    return [];
  }
  return searchPurchaseProducts(warehouseId, query, { inStockOnly: true });
}
