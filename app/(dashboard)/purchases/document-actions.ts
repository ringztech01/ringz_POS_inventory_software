import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decreaseStock, increaseStock } from "@/lib/stock";
import type { StockDelta } from "@/lib/purchase-stock";
import { computeLine, computeOrder, sumSubtotals, toDecimal } from "@/lib/pricing";
import { purchaseSchema, type PurchaseInput } from "@/lib/validations/purchase";
import type { PurchaseActionState, PurchaseFieldName } from "./types";

// Shared server-side machinery for purchase documents (Purchases, Purchase
// Returns). Deliberately NOT a "use server" file: everything exported from
// one of those becomes a callable server action, and none of these helpers
// should be reachable from the browser on their own.

export const MAX_REFERENCE_ATTEMPTS = 3;

// zod issues → { field: [messages] }. Item issues are collected under
// "items" and prefixed with their line number so the user can find them.
export function toFieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Partial<Record<PurchaseFieldName, string[]>> = {};
  for (const issue of error.issues) {
    const [field, index] = issue.path;
    const key = (typeof field === "string" ? field : "items") as PurchaseFieldName;
    const message = key === "items" && typeof index === "number" ? `Line ${index + 1}: ${issue.message}` : issue.message;
    (fieldErrors[key] ??= []).push(message);
  }
  return fieldErrors;
}

export function invalid(fieldErrors: Partial<Record<PurchaseFieldName, string[]>>): PurchaseActionState {
  return { ok: false, error: "Please fix the errors below.", fieldErrors };
}

export function isReferenceCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta?.target ?? "").includes("reference")
  );
}

// Records an existing document already points at. On edit these stay valid
// even if they've since been soft-deleted, so an old document can still be
// corrected; anything newly chosen must be active.
export type ExistingRefs = { warehouseId: string; partyId: string; productIds: string[] };

const activeOr = (ids: string[]) => ({ OR: [{ deletedAt: null }, { id: { in: ids } }] });

// The parts of a parsed document every loader needs. The unit is any string
// (purchase, sale or transfer units — each schema checks its own list).
type DocumentInputCore = Pick<PurchaseInput, "warehouseId" | "orderTax" | "discount" | "shipping"> & {
  items: (Omit<PurchaseInput["items"][number], "unitCost" | "purchaseUnit"> & { unitCost?: string; purchaseUnit: string })[];
};

// Re-reads everything a validated document points at and recomputes it. The
// client's names, stock and totals are never trusted — only its ids and the
// user's inputs.
//   party:         which table partyId refers to (Supplier or Customer);
//                  null for Transfers, which have none (partyId ignored).
//   priceFallback: Sales — a line without a unit price gets the product's
//                  price from the DB.
export async function loadDocument<T extends DocumentInputCore>(
  data: T,
  partyId: string,
  { party, existing, priceFallback = false }: { party: "supplier" | "customer" | null; existing?: ExistingRefs; priceFallback?: boolean },
) {
  const partyField = party === "supplier" ? "supplierId" : "customerId";
  const partyWhere = { id: partyId, ...activeOr(existing ? [existing.partyId] : []) };

  const [warehouse, partyRecord, products] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: data.warehouseId, ...activeOr(existing ? [existing.warehouseId] : []) },
      select: { id: true, name: true },
    }),
    party === null
      ? Promise.resolve({ id: "" })
      : party === "supplier"
        ? prisma.supplier.findFirst({ where: partyWhere, select: { id: true } })
        : prisma.customer.findFirst({ where: partyWhere, select: { id: true } }),
    prisma.product.findMany({
      where: { id: { in: data.items.map((item) => item.productId) }, ...activeOr(existing?.productIds ?? []) },
      select: { id: true, name: true, price: true },
    }),
  ]);

  if (!warehouse) return { kind: "invalid" as const, state: invalid({ warehouseId: ["Warehouse not found."] }) };
  if (!partyRecord) {
    return { kind: "invalid" as const, state: invalid({ [partyField]: [`${party === "supplier" ? "Supplier" : "Customer"} not found.`] }) };
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  if (data.items.some((item) => !productById.has(item.productId))) {
    return {
      kind: "invalid" as const,
      state: invalid({ items: ["One of the selected products no longer exists. Remove it and try again."] }),
    };
  }

  // Fill missing unit prices from the DB (Sales), then re-check the one rule
  // zod couldn't while the price was unknown.
  const items = data.items.map((item) => ({
    ...item,
    unitCost: item.unitCost ?? (priceFallback ? productById.get(item.productId)!.price.toFixed(2) : "0"),
  }));
  const badDiscount = items.findIndex(
    (item) => item.discountType === "FIXED" && toDecimal(item.discount).greaterThan(toDecimal(item.unitCost)),
  );
  if (badDiscount !== -1) {
    return {
      kind: "invalid" as const,
      state: invalid({ items: [`Line ${badDiscount + 1}: Discount can't be more than the unit price.`] }),
    };
  }

  // Every line and the order total are recomputed here with the same
  // lib/pricing.ts the form uses for its live totals.
  const lines = items.map((item) => ({ item, priced: computeLine(item) }));
  const order = computeOrder({
    itemsTotal: sumSubtotals(lines.map((line) => line.priced.subtotal)),
    taxRate: data.orderTax,
    discount: data.discount,
    shipping: data.shipping,
  });

  // computeOrder caps an oversized discount; on save that's an input error.
  if (toDecimal(data.discount).greaterThan(order.itemsTotal)) {
    return { kind: "invalid" as const, state: invalid({ discount: ["Discount can't be more than the items total."] }) };
  }

  return { kind: "ok" as const, data: { ...data, items }, warehouse, productById, lines, order };
}

// Purchases and Purchase Returns: parse + load against Supplier.
export async function parseAndLoad(input: unknown, existing?: ExistingRefs) {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "invalid" as const, state: invalid(toFieldErrors(parsed.error)) };
  }
  return loadDocument(parsed.data, parsed.data.supplierId, { party: "supplier", existing });
}

export type Loaded = Extract<Awaited<ReturnType<typeof parseAndLoad>>, { kind: "ok" }>;

// Line rows for PurchaseItem / PurchaseReturnItem (identical columns).
export function documentItemsData(lines: Pick<Loaded, "lines">["lines"]) {
  return lines.map(({ item, priced }) => ({
    productId: item.productId,
    quantity: item.quantity,
    purchaseUnit: item.purchaseUnit,
    // The unit cost as entered; net/discount per unit are re-derived from
    // these inputs through lib/pricing.ts whenever they're displayed.
    netUnitCost: priced.unitCost.toFixed(2),
    discountType: item.discountType,
    discount: toDecimal(item.discount).toFixed(2),
    taxType: item.taxType,
    orderTax: toDecimal(item.taxRate).toFixed(2),
    taxAmount: priced.taxAmount.toFixed(2),
    subtotal: priced.subtotal.toFixed(2),
  }));
}

// Header columns shared by Purchase, PurchaseReturn and Sale, all
// server-computed. Callers add their party (supplierId / customerId).
export function documentOrderData<S extends string>(
  // S: the document's own status enum (PurchaseStatus, SaleReturnStatus).
  data: { warehouseId: string; date: Date; status: S; notes?: string },
  order: Loaded["order"],
) {
  return {
    warehouseId: data.warehouseId,
    date: data.date,
    status: data.status,
    orderTax: order.taxRate.toFixed(2),
    orderTaxAmount: order.orderTaxAmount.toFixed(2),
    discount: order.discount.toFixed(2),
    shipping: order.shipping.toFixed(2),
    grandTotal: order.grandTotal.toFixed(2),
    notes: data.notes ?? null,
  };
}

export function revalidateDocumentPaths(listPath: string, productIds: string[], documentId?: string) {
  revalidatePath(listPath);
  if (documentId) revalidatePath(`${listPath}/${documentId}`);
  revalidatePath("/products");
  for (const productId of new Set(productIds)) {
    revalidatePath(`/products/${productId}`);
  }
}

// Thrown inside a transaction when the document changed (or was deleted)
// between loading it and saving — rolls the transaction back.
export class DocumentChangedError extends Error {}

// Applies stock deltas from lib/purchase-stock.ts through the stock service.
// Decreases come first and throw InsufficientStockError rather than ever
// writing a negative balance, rolling the caller's transaction back.
export async function applyStockDeltas(
  tx: Prisma.TransactionClient,
  deltas: StockDelta[],
  supplierId: string | undefined,
) {
  if (deltas.length === 0) return;

  const [products, warehouses] = await Promise.all([
    tx.product.findMany({ where: { id: { in: deltas.map((d) => d.productId) } }, select: { id: true, name: true } }),
    tx.warehouse.findMany({ where: { id: { in: deltas.map((d) => d.warehouseId) } }, select: { id: true, name: true } }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));

  for (const { productId, warehouseId, delta } of deltas) {
    if (delta > 0) {
      await increaseStock(tx, { productId, warehouseId, quantity: delta, supplierId });
    } else {
      await decreaseStock(tx, {
        productId,
        warehouseId,
        quantity: -delta,
        productName: productName.get(productId) ?? "A product",
        warehouseName: warehouseName.get(warehouseId) ?? "the warehouse",
      });
    }
  }
}
