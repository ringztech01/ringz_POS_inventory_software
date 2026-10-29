import "server-only";
import { prisma } from "@/lib/db";
import { generateReference } from "@/lib/reference";
import { InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import { toDecimal } from "@/lib/pricing";
import { computePaymentState } from "@/lib/payments";
import { formatNaira } from "@/lib/format";
import { saleSchema } from "@/lib/validations/sale";
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

function notEnoughStock(error: InsufficientStockError): PurchaseActionState {
  return {
    ok: false,
    error: `Not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, selling ${error.requested}).`,
  };
}

// Saving a new sale — the ONE path every sale takes: the Sales form (via
// createSale, Manage Sale) and the POS till (via createPosSale, Manage Pos
// Screen). Callers check the permission and pass the signed-in user; this
// validates, prices with lib/pricing.ts, checks and moves stock, takes the
// first payment and issues the SA_ reference.
export async function saveNewSale(input: unknown, userId: string): Promise<PurchaseActionState> {
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  // Re-reads warehouse, customer and products; a line without a unit price
  // gets the product's price from the DB; every line and the grand total are
  // recomputed with lib/pricing.ts. Client totals are never used.
  const loaded = await loadDocument(parsed.data, parsed.data.customerId, { party: "customer", priceFallback: true });
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order } = loaded;

  const paidAmount = toDecimal(data.paidAmount).toDecimalPlaces(2);
  if (paidAmount.greaterThan(order.grandTotal)) {
    return invalid({
      paidAmount: [`Paid can't be more than the grand total (${formatNaira(order.grandTotal.toFixed(2))}).`],
    });
  }

  // The optional first payment, taken with the sale on the sale's date.
  const payments = paidAmount.isZero()
    ? []
    : [{ amount: paidAmount.toFixed(2), paymentType: data.paymentType, date: data.date }];
  const paymentState = computePaymentState(order.grandTotal, payments);

  // One transaction: SA_ reference, the sale + items + first payment, and —
  // only when the status is Received (same rule as Purchases) — the stock
  // decrement for every line in the selected warehouse. Pending/Ordered move
  // no stock.
  //
  // A sale takes stock OUT, so the reconciliation runs with direction "out"
  // (lib/purchase-stock.ts). Each decrement goes through decreaseStock, which
  // checks the current quantity inside the transaction and refuses to go below
  // zero: a line selling more than is held throws InsufficientStockError and
  // everything (sale, items, payment) rolls back.
  //
  // References are random (shared prefix generator); the unique index on
  // Sale.reference makes this race-safe — a collision rolls back and retries.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
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

        const after = { status: data.status, warehouseId: data.warehouseId, items: data.items };
        await applyStockDeltas(tx, purchaseStockDeltas(null, after, "out"), undefined);

        return sale;
      });

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
