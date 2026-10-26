"use server";

import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { generateReference } from "@/lib/reference";
import { increaseStock, InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas, type PurchaseStockState } from "@/lib/purchase-stock";
import {
  applyStockDeltas,
  DocumentChangedError,
  documentItemsData,
  documentOrderData,
  isReferenceCollision,
  MAX_REFERENCE_ATTEMPTS,
  parseAndLoad,
  revalidateDocumentPaths,
} from "./document-actions";
import { getStockByProduct, searchPurchaseProducts } from "./product-search";
import type { PurchaseActionState, PurchaseProductSearchResult } from "./types";

const requireManagePurchases = () => requirePermission(PERMISSIONS.MANAGE_PURCHASE);

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
            ...documentOrderData(data, order),
            supplierId: data.supplierId,
            reference: generateReference("PU"),
            createdById: authCheck.userId,
            items: { create: documentItemsData(lines) },
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

      revalidateDocumentPaths("/purchases", data.items.map((item) => item.productId));
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
    partyId: current.supplierId,
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
      if (!before) throw new DocumentChangedError();

      // ...and the header update is conditional on it being unchanged. This
      // UPDATE also row-locks the purchase until commit, so two concurrent
      // edits can't both reconcile against the same "before" (which would
      // apply the stock difference twice): the second one matches 0 rows.
      const { count } = await tx.purchase.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { ...documentOrderData(data, order), supplierId: data.supplierId },
      });
      if (count === 0) throw new DocumentChangedError();

      // Reconcile stock by the difference only — see lib/purchase-stock.ts.
      // Re-running create's "add every line" logic here would double-add.
      const after: PurchaseStockState = { status: data.status, warehouseId: data.warehouseId, items: data.items };
      await applyStockDeltas(tx, purchaseStockDeltas(before, after), data.supplierId);

      // Lines are replaced wholesale; nothing references PurchaseItem ids.
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseItem.createMany({
        data: documentItemsData(lines).map((item) => ({ ...item, purchaseId: id })),
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
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This purchase was changed or deleted by someone else. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths("/purchases", [...previousProductIds, ...data.items.map((item) => item.productId)], id);
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
      if (!before) throw new DocumentChangedError();

      // Conditional on the state just read, and row-locks the purchase, so a
      // concurrent edit/delete can't reverse the stock a second time.
      const { count } = await tx.purchase.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DocumentChangedError();

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
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This purchase was changed or already deleted. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths("/purchases", productIds, id);
  return { ok: true, id, reference };
}

// Read-only, so only a session is required — Manage Purchase is enforced on
// the save/delete mutations. Any active product (see product-search.ts).
export async function searchProductsForPurchase(
  warehouseId: string,
  query: string,
): Promise<PurchaseProductSearchResult[]> {
  if (!(await can(PERMISSIONS.MANAGE_PURCHASE))) {
    return [];
  }
  return searchPurchaseProducts(warehouseId, query, { inStockOnly: false });
}

// Re-reads the reference stock for rows already in the form when the user
// switches warehouse, so the items don't have to be cleared and re-added.
export async function getPurchaseStockForProducts(
  warehouseId: string,
  productIds: string[],
): Promise<Record<string, number>> {
  if (!(await can(PERMISSIONS.MANAGE_PURCHASE)) || !warehouseId || productIds.length === 0) {
    return {};
  }

  const stockByProduct = await getStockByProduct(warehouseId, productIds.slice(0, 200));
  return Object.fromEntries(productIds.map((id) => [id, stockByProduct.get(id) ?? 0]));
}
