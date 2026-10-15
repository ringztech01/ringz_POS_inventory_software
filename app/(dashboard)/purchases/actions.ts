"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { generateReference } from "@/lib/reference";
import { decreaseStock, increaseStock, InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas, type PurchaseStockState } from "@/lib/purchase-stock";
import { computeLine, computeOrder, sumSubtotals, toDecimal } from "@/lib/pricing";
import { purchaseSchema, type PurchaseInput } from "@/lib/validations/purchase";
import type {
  PurchaseActionState,
  PurchaseFieldName,
  PurchaseProductSearchResult,
} from "./types";

const MAX_REFERENCE_ATTEMPTS = 3;

async function requireManagePurchases(): Promise<{ error: string; userId?: undefined } | { error?: undefined; userId: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_PURCHASES)) {
    return { error: "You don't have permission to manage purchases." };
  }

  return { userId: session.user.id };
}

// zod issues → { field: [messages] }. Item issues are collected under
// "items" and prefixed with their line number so the user can find them.
function toFieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Partial<Record<PurchaseFieldName, string[]>> = {};
  for (const issue of error.issues) {
    const [field, index] = issue.path;
    const key = (typeof field === "string" ? field : "items") as PurchaseFieldName;
    const message = key === "items" && typeof index === "number" ? `Line ${index + 1}: ${issue.message}` : issue.message;
    (fieldErrors[key] ??= []).push(message);
  }
  return fieldErrors;
}

function invalid(fieldErrors: Partial<Record<PurchaseFieldName, string[]>>): PurchaseActionState {
  return { ok: false, error: "Please fix the errors below.", fieldErrors };
}

function isReferenceCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta?.target ?? "").includes("reference")
  );
}

// Records an existing purchase already points at. On edit these stay valid
// even if they've since been soft-deleted, so an old purchase can still be
// corrected; anything newly chosen must be active.
type ExistingRefs = { warehouseId: string; supplierId: string; productIds: string[] };

const activeOr = (ids: string[]) => ({ OR: [{ deletedAt: null }, { id: { in: ids } }] });

// Validates the raw form payload and re-reads everything it points at. The
// client's product names, stock and totals are never trusted — only its ids
// and the user's inputs, which are checked here.
async function parseAndLoad(input: unknown, existing?: ExistingRefs) {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "invalid" as const, state: invalid(toFieldErrors(parsed.error)) };
  }
  const data = parsed.data;

  const [warehouse, supplier, products] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: data.warehouseId, ...activeOr(existing ? [existing.warehouseId] : []) },
      select: { id: true, name: true },
    }),
    prisma.supplier.findFirst({
      where: { id: data.supplierId, ...activeOr(existing ? [existing.supplierId] : []) },
      select: { id: true },
    }),
    prisma.product.findMany({
      where: { id: { in: data.items.map((item) => item.productId) }, ...activeOr(existing?.productIds ?? []) },
      select: { id: true, name: true },
    }),
  ]);

  if (!warehouse) return { kind: "invalid" as const, state: invalid({ warehouseId: ["Warehouse not found."] }) };
  if (!supplier) return { kind: "invalid" as const, state: invalid({ supplierId: ["Supplier not found."] }) };

  const productById = new Map(products.map((product) => [product.id, product]));
  if (data.items.some((item) => !productById.has(item.productId))) {
    return {
      kind: "invalid" as const,
      state: invalid({ items: ["One of the selected products no longer exists. Remove it and try again."] }),
    };
  }

  // Every line and the order total are recomputed here with the same
  // lib/pricing.ts the form uses for its live totals.
  const lines = data.items.map((item) => ({ item, priced: computeLine(item) }));
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

  return { kind: "ok" as const, data, warehouse, productById, lines, order };
}

type Loaded = Extract<Awaited<ReturnType<typeof parseAndLoad>>, { kind: "ok" }>;

function purchaseItemsData(lines: Loaded["lines"]) {
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

function purchaseOrderData(data: PurchaseInput, order: Loaded["order"]) {
  return {
    supplierId: data.supplierId,
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

function revalidatePurchasePaths(productIds: string[], purchaseId?: string) {
  revalidatePath("/purchases");
  if (purchaseId) revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/products");
  for (const productId of new Set(productIds)) {
    revalidatePath(`/products/${productId}`);
  }
}

export async function createPurchase(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManagePurchases();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const loaded = await parseAndLoad(input);
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order } = loaded;

  // One transaction: reference, the Purchase and its items, and — only when
  // the status is Received — the stock increase for every line. Pending and
  // Ordered purchases record the order without touching stock.
  //
  // References come from the shared prefix generator (PU_…). They're random,
  // so the DB unique index on Purchase.reference is what makes this
  // race-safe: a collision fails the insert (P2002), rolls the whole
  // transaction back, and we simply retry with a fresh reference.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const purchase = await tx.purchase.create({
          data: {
            ...purchaseOrderData(data, order),
            reference: generateReference("PU"),
            createdById: authCheck.userId,
            items: { create: purchaseItemsData(lines) },
          },
          select: { id: true, reference: true },
        });

        if (data.status === "RECEIVED") {
          for (const { item } of lines) {
            await increaseStock(tx, {
              productId: item.productId,
              warehouseId: data.warehouseId,
              quantity: item.quantity,
              supplierId: data.supplierId,
            });
          }
        }

        return purchase;
      });

      revalidatePurchasePaths(data.items.map((item) => item.productId));
      return { ok: true, id: created.id, reference: created.reference };
    } catch (error) {
      if (isReferenceCollision(error)) {
        if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
}

// Thrown inside a transaction when the purchase changed (or was deleted)
// between loading it and saving — rolls the transaction back.
class PurchaseChangedError extends Error {}

// Applies stock deltas from lib/purchase-stock.ts through the stock service.
// Decreases come first and throw InsufficientStockError rather than ever
// writing a negative balance, rolling the caller's transaction back.
async function applyStockDeltas(
  tx: Prisma.TransactionClient,
  deltas: ReturnType<typeof purchaseStockDeltas>,
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

export async function updatePurchase(id: string, input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManagePurchases();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the purchase server-side; the id is the only thing taken from
  // the client.
  const current = await prisma.purchase.findFirst({
    where: { id, deletedAt: null },
    select: { warehouseId: true, supplierId: true, items: { select: { productId: true } } },
  });
  if (!current) {
    return { ok: false, error: "Purchase not found. It may have been deleted." };
  }

  const loaded = await parseAndLoad(input, {
    warehouseId: current.warehouseId,
    supplierId: current.supplierId,
    productIds: current.items.map((item) => item.productId),
  });
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order } = loaded;

  let previousProductIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // The "before" state is read inside the transaction...
      const before = await tx.purchase.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new PurchaseChangedError();

      // ...and the header update is conditional on it being unchanged. This
      // UPDATE also row-locks the purchase until commit, so two concurrent
      // edits can't both reconcile against the same "before" (which would
      // apply the stock difference twice): the second one matches 0 rows.
      const { count } = await tx.purchase.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: purchaseOrderData(data, order),
      });
      if (count === 0) throw new PurchaseChangedError();

      // Reconcile stock by the difference only — see lib/purchase-stock.ts.
      // Re-running create's "add every line" logic here would double-add.
      const after: PurchaseStockState = { status: data.status, warehouseId: data.warehouseId, items: data.items };
      await applyStockDeltas(tx, purchaseStockDeltas(before, after), data.supplierId);

      // Lines are replaced wholesale; nothing references PurchaseItem ids.
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseItem.createMany({
        data: purchaseItemsData(lines).map((item) => ({ ...item, purchaseId: id })),
      });

      previousProductIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't save — ${error.productName} stock in ${error.warehouseName} is ${error.available}, but this change removes ${error.requested}. It was probably already sold or moved.`,
      };
    }
    if (error instanceof PurchaseChangedError) {
      return { ok: false, error: "This purchase was changed or deleted by someone else. Reload the page and try again." };
    }
    throw error;
  }

  revalidatePurchasePaths([...previousProductIds, ...data.items.map((item) => item.productId)], id);
  return { ok: true, id, reference };
}

// Soft delete. A Received purchase put stock into its warehouse, so deleting
// it takes that stock back out (the same reconciliation as an edit, with
// nothing after it). If some of that stock has since been sold or moved the
// delete is refused — stock is never written negative.
export async function deletePurchase(id: string): Promise<PurchaseActionState> {
  const authCheck = await requireManagePurchases();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let productIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the purchase server-side; only its id came from the client.
      const before = await tx.purchase.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new PurchaseChangedError();

      // Conditional on the state just read, and row-locks the purchase, so a
      // concurrent edit/delete can't reverse the stock a second time.
      const { count } = await tx.purchase.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new PurchaseChangedError();

      // Received → reverse every line; Pending/Ordered → no stock movement.
      await applyStockDeltas(tx, purchaseStockDeltas(before, null), undefined);

      productIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't delete — ${error.productName} stock in ${error.warehouseName} is lower than this purchase added.`,
      };
    }
    if (error instanceof PurchaseChangedError) {
      return { ok: false, error: "This purchase was changed or already deleted. Reload the page and try again." };
    }
    throw error;
  }

  revalidatePurchasePaths(productIds, id);
  return { ok: true, id, reference };
}

async function getStockByProduct(warehouseId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const stocks = await prisma.productStock.findMany({
    where: { warehouseId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  return new Map(stocks.map((row) => [row.productId, row.quantity]));
}

// Read-only, so only a session is required — Manage Purchase is enforced on
// the save/delete mutations.
//
// Unlike Adjustments, results are NOT limited to products already stocked in
// the warehouse (or supplied by the supplier): a purchase is how new stock
// arrives, so any active product can be bought into any warehouse. The
// warehouse is only used to show its current stock as a reference (0 when
// there's no ProductStock row yet).
export async function searchProductsForPurchase(
  warehouseId: string,
  query: string,
): Promise<PurchaseProductSearchResult[]> {
  const session = await auth();
  if (!session?.user) {
    return [];
  }

  const trimmed = query.trim();
  if (!warehouseId || trimmed.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [{ name: { contains: trimmed } }, { code: { contains: trimmed } }],
    },
    select: {
      id: true,
      name: true,
      code: true,
      cost: true,
      taxType: true,
      orderTax: true,
      unit: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 8,
  });

  const stockByProduct = await getStockByProduct(
    warehouseId,
    products.map((product) => product.id),
  );

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    code: product.code,
    unitName: product.unit.name,
    cost: product.cost?.toFixed(2) ?? "0.00",
    taxType: product.taxType,
    orderTax: (product.orderTax ?? 0).toString(),
    stock: stockByProduct.get(product.id) ?? 0,
  }));
}

// Re-reads the reference stock for rows already in the form when the user
// switches warehouse, so the items don't have to be cleared and re-added.
export async function getPurchaseStockForProducts(
  warehouseId: string,
  productIds: string[],
): Promise<Record<string, number>> {
  const session = await auth();
  if (!session?.user || !warehouseId || productIds.length === 0) {
    return {};
  }

  const stockByProduct = await getStockByProduct(warehouseId, productIds.slice(0, 200));
  return Object.fromEntries(productIds.map((id) => [id, stockByProduct.get(id) ?? 0]));
}
