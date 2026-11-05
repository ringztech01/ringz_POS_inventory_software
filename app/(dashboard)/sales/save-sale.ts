import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateReference } from "@/lib/reference";
import { InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import { sumSubtotals, toDecimal } from "@/lib/pricing";
import { computePaymentState } from "@/lib/payments";
import { formatNaira } from "@/lib/format";
import { salePaymentSchema, saleSchema, type SaleInput, type SalePaymentInput } from "@/lib/validations/sale";
import {
  applyStockDeltas,
  documentItemsData,
  documentOrderData,
  invalid,
  isReferenceCollision,
  loadDocument,
  MAX_REFERENCE_ATTEMPTS,
  revalidateDocumentPaths,
  toFieldErrors,
  type Loaded,
} from "../purchases/document-actions";
import type { PurchaseActionState } from "../purchases/types";

const LIST_PATH = "/sales";

// The shared line rows use purchase column names; SaleItem calls them
// netUnitPrice / saleUnit.
export function saleItemsData(lines: Pick<Loaded, "lines">["lines"]) {
  return documentItemsData(lines).map(({ netUnitCost, purchaseUnit, ...rest }) => ({
    ...rest,
    netUnitPrice: netUnitCost,
    saleUnit: purchaseUnit,
  }));
}

export function notEnoughStock(error: InsufficientStockError): PurchaseActionState {
  return {
    ok: false,
    error: `Not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, selling ${error.requested}).`,
  };
}

// A new sale checked and priced, ready to be written (prepareSale).
export type PreparedSale = {
  data: SaleInput;
  lines: Loaded["lines"];
  order: Loaded["order"];
  payments: { amount: string; paymentType: SaleInput["paymentType"]; date: Date; notes?: string | null }[];
};

// Checks and prices a new sale, without writing anything: saleSchema, then
// loadDocument re-reads warehouse, customer and products; a line without a
// unit price gets the product's price from the DB; every line and the grand
// total are recomputed with lib/pricing.ts. Client totals are never used.
// `morePayments` (the restaurant's bill paid by several methods; none from
// the Sales form or the till): further payments taken with the sale — each
// as Add payment takes one, and with the first never more than the total.
export async function prepareSale(
  input: unknown,
  morePayments: readonly unknown[] = [],
): Promise<{ ok: true; sale: PreparedSale } | { ok: false; state: PurchaseActionState }> {
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, state: invalid(toFieldErrors(parsed.error)) };
  }

  const loaded = await loadDocument(parsed.data, parsed.data.customerId, { party: "customer", priceFallback: true });
  if (loaded.kind === "invalid") return { ok: false, state: loaded.state };
  const { data, lines, order } = loaded;

  const paidAmount = toDecimal(data.paidAmount).toDecimalPlaces(2);
  if (paidAmount.greaterThan(order.grandTotal)) {
    return {
      ok: false,
      state: invalid({
        paidAmount: [`Paid can't be more than the grand total (${formatNaira(order.grandTotal.toFixed(2))}).`],
      }),
    };
  }

  const more: SalePaymentInput[] = [];
  for (const payment of morePayments) {
    const one = salePaymentSchema.safeParse(payment);
    if (!one.success) return { ok: false, state: invalid({ paidAmount: ["One of the payments isn't valid."] }) };
    more.push(one.data);
  }
  const paidInAll = sumSubtotals([paidAmount, ...more.map((payment) => payment.amount)]);
  if (paidInAll.greaterThan(order.grandTotal)) {
    return {
      ok: false,
      state: invalid({
        paidAmount: [`Payments can't be more than the grand total (${formatNaira(order.grandTotal.toFixed(2))}).`],
      }),
    };
  }

  // The optional first payment, taken with the sale on the sale's date; then
  // any further ones on their own dates.
  const payments: PreparedSale["payments"] = [
    ...(paidAmount.isZero() ? [] : [{ amount: paidAmount.toFixed(2), paymentType: data.paymentType, date: data.date }]),
    ...more.map((payment) => ({ amount: toDecimal(payment.amount).toFixed(2), paymentType: payment.paymentType, date: payment.date, notes: payment.notes ?? null })),
  ];
  return { ok: true, sale: { data, lines, order, payments } };
}

// Writes a prepared sale inside the caller's transaction: SA_ reference, the
// sale + items + payments, and — with `moveStock`, only when the status is
// Received (same rule as Purchases) — the stock decrement for every line in
// the selected warehouse. Pending/Ordered move no stock. (The restaurant
// moves its own: a dish's recipe, not the dish.)
//
// A sale takes stock OUT, so the reconciliation runs with direction "out"
// (lib/purchase-stock.ts). Each decrement goes through decreaseStock, which
// checks the current quantity inside the transaction and refuses to go below
// zero: a line selling more than is held throws InsufficientStockError and
// the caller's whole transaction rolls back. A reference collision throws
// too (isReferenceCollision); the caller retries.
export async function writeSaleInTx(
  tx: Prisma.TransactionClient,
  prepared: PreparedSale,
  userId: string,
  { moveStock }: { moveStock: boolean },
): Promise<{ id: string; reference: string }> {
  const { data, lines, order, payments } = prepared;
  const paymentState = computePaymentState(order.grandTotal, payments);
  const sale = await tx.sale.create({
    data: {
      ...documentOrderData(data, order),
      customerId: data.customerId,
      reference: generateReference("SA"),
      // Derived from the payments below — never typed in.
      paid: paymentState.paid.toFixed(2),
      due: paymentState.due.toFixed(2),
      paymentStatus: paymentState.paymentStatus,
      paymentType: paymentState.paymentType,
      createdById: userId,
      items: { create: saleItemsData(lines) },
      payments: {
        create: payments.map((payment) => ({ ...payment, createdById: userId })),
      },
    },
    select: { id: true, reference: true },
  });

  if (moveStock) {
    const after = { status: data.status, warehouseId: data.warehouseId, items: data.items };
    await applyStockDeltas(tx, purchaseStockDeltas(null, after, "out"), undefined);
  }
  return sale;
}

// prepareSale + writeSaleInTx in the caller's transaction (the restaurant's
// settle, which also moves its own stock and closes the order there).
// Refusals come back as the Sales form's states; InsufficientStockError and
// reference collisions are thrown for the caller's transaction to roll back.
export async function saveSaleInTx(
  tx: Prisma.TransactionClient,
  input: unknown,
  userId: string,
  { moveStock, morePayments = [] }: { moveStock: boolean; morePayments?: readonly unknown[] },
): Promise<{ ok: true; id: string; reference: string } | { ok: false; state: PurchaseActionState }> {
  const prepared = await prepareSale(input, morePayments);
  if (!prepared.ok) return prepared;
  return { ok: true, ...(await writeSaleInTx(tx, prepared.sale, userId, { moveStock })) };
}

// Saving a new sale — the ONE path every sale takes: the Sales form (via
// createSale, Manage Sale), the POS till (via createPosSale, Manage Pos
// Screen) and the restaurant's settle (via saveSaleInTx). Callers check the
// permission and pass the signed-in user; this validates, prices with
// lib/pricing.ts, checks and moves stock, takes the first payment and issues
// the SA_ reference.
//
// References are random (shared prefix generator); the unique index on
// Sale.reference makes this race-safe — a collision rolls back and retries.
export async function saveNewSale(input: unknown, userId: string): Promise<PurchaseActionState> {
  const prepared = await prepareSale(input);
  if (!prepared.ok) return prepared.state;
  const { data } = prepared.sale;

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction((tx) => writeSaleInTx(tx, prepared.sale, userId, { moveStock: true }));

      revalidateDocumentPaths(LIST_PATH, data.items.map((item) => item.productId));
      return { ok: true, id: created.id, reference: created.reference };
    } catch (error) {
      if (error instanceof InsufficientStockError) return notEnoughStock(error);
      if (isReferenceCollision(error)) {
        if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
}

export class SalePaymentError extends Error {}

// Restaurant: payments for a later part of a split bill, added to the order's
// sale inside the settle's transaction. The rule is retail's — the payments
// come off the sale's due (computePaymentState) and can't be more than it;
// paid / due / status / type are then stored from all its active payments —
// as the Sales page's Add payment (sales/actions.ts) does for one payment.
// The update only applies if the sale is unchanged since it was read here.
// Throws SalePaymentError for the caller's transaction to roll back.
export async function addSalePaymentsInTx(
  tx: Prisma.TransactionClient,
  saleId: string,
  payments: readonly unknown[],
  userId: string,
): Promise<void> {
  const adding: SalePaymentInput[] = [];
  for (const payment of payments) {
    const one = salePaymentSchema.safeParse(payment);
    if (!one.success) throw new SalePaymentError("One of the payments isn't valid.");
    adding.push(one.data);
  }
  if (adding.length === 0) return;

  const sale = await tx.sale.findFirst({
    where: { id: saleId, deletedAt: null },
    select: {
      id: true,
      grandTotal: true,
      updatedAt: true,
      payments: { where: { deletedAt: null }, select: { amount: true, paymentType: true, date: true, createdAt: true } },
    },
  });
  if (!sale) throw new SalePaymentError("This order's sale was changed or deleted.");

  const existing = sale.payments.map((p) => ({ amount: p.amount.toString(), paymentType: p.paymentType, date: p.date, createdAt: p.createdAt }));
  const { due } = computePaymentState(sale.grandTotal.toString(), existing);
  if (sumSubtotals(adding.map((p) => p.amount)).greaterThan(due)) {
    throw new SalePaymentError(`The payments are more than the sale's amount due (${formatNaira(due.toFixed(2))}).`);
  }

  const created = [];
  for (const payment of adding) {
    created.push(
      await tx.salePayment.create({
        data: {
          saleId,
          amount: toDecimal(payment.amount).toFixed(2),
          paymentType: payment.paymentType,
          date: payment.date,
          notes: payment.notes ?? null,
          createdById: userId,
        },
        select: { amount: true, paymentType: true, date: true, createdAt: true },
      }),
    );
  }
  const state = computePaymentState(sale.grandTotal.toString(), [
    ...existing,
    ...created.map((p) => ({ amount: p.amount.toString(), paymentType: p.paymentType, date: p.date, createdAt: p.createdAt })),
  ]);
  const { count } = await tx.sale.updateMany({
    where: { id: saleId, deletedAt: null, updatedAt: sale.updatedAt },
    data: { paid: state.paid.toFixed(2), due: state.due.toFixed(2), paymentStatus: state.paymentStatus, paymentType: state.paymentType },
  });
  if (count === 0) throw new SalePaymentError("This order's sale was changed while paying. Try again.");
}
