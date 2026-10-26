"use server";

import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { generateReference } from "@/lib/reference";
import { InsufficientStockError } from "@/lib/stock";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import {
  applyStockDeltas,
  DocumentChangedError,
  documentItemsData,
  documentOrderData,
  isReferenceCollision,
  MAX_REFERENCE_ATTEMPTS,
  parseAndLoad,
  revalidateDocumentPaths,
} from "../document-actions";
import { searchPurchaseProducts } from "../product-search";
import type { PurchaseActionState, PurchaseProductSearchResult } from "../types";

const LIST_PATH = "/purchases/returns";
const requireManageReturns = () => requirePermission(PERMISSIONS.MANAGE_PURCHASE_RETURN);

function notEnoughStock(error: InsufficientStockError): PurchaseActionState {
  return {
    ok: false,
    error: `Not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, returning ${error.requested}).`,
  };
}

export async function createPurchaseReturn(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Validates and re-reads warehouse, supplier and products server-side, and
  // recomputes every line and the grand total with lib/pricing.ts.
  const loaded = await parseAndLoad(input);
  if (loaded.kind === "invalid") return loaded.state;
  const { data, lines, order } = loaded;

  // One transaction: PR_ reference, the return and its items, and — only when
  // the status is Received — the stock decrement for every line in the
  // selected warehouse. Pending/Ordered returns move no stock.
  //
  // A return takes stock OUT, so the reconciliation runs with direction
  // "out" (see lib/purchase-stock.ts). Each decrement goes through
  // decreaseStock, which checks the current quantity inside the transaction
  // and refuses to go below zero: any line returning more than is held throws
  // InsufficientStockError and the whole return rolls back with no changes.
  //
  // References are random (shared prefix generator), so the unique index on
  // PurchaseReturn.reference makes this race-safe: a collision rolls back and
  // we retry with a fresh one.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const grandTotal = order.grandTotal.toFixed(2);
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            ...documentOrderData(data, order),
            supplierId: data.supplierId,
            reference: generateReference("PR"),
            // No payment inputs in the design yet: nothing paid, all due.
            paid: "0.00",
            due: grandTotal,
            createdById: authCheck.userId,
            items: { create: documentItemsData(lines) },
          },
          select: { id: true, reference: true },
        });

        const after = { status: data.status, warehouseId: data.warehouseId, items: data.items };
        await applyStockDeltas(tx, purchaseStockDeltas(null, after, "out"), undefined);

        return purchaseReturn;
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

export async function updatePurchaseReturn(id: string, input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the return server-side; the id is the only thing taken from the
  // client (and the page binds it — the form never sends it).
  const current = await prisma.purchaseReturn.findFirst({
    where: { id, deletedAt: null },
    select: { warehouseId: true, supplierId: true, items: { select: { productId: true } } },
  });
  if (!current) {
    return { ok: false, error: "Purchase return not found. It may have been deleted." };
  }

  // Totals are recomputed server-side with lib/pricing.ts, as on create.
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
      const before = await tx.purchaseReturn.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          warehouseId: true,
          paid: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new DocumentChangedError();

      // ...and the header update only applies if it's unchanged. The UPDATE
      // also row-locks the return until commit, so two concurrent edits can't
      // both reconcile against the same "before" and move the stock twice.
      const grandTotal = order.grandTotal;
      const { count } = await tx.purchaseReturn.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: {
          ...documentOrderData(data, order),
          supplierId: data.supplierId,
          // Paid isn't editable yet (no payment inputs); due follows the
          // recomputed grand total.
          due: grandTotal.minus(before.paid.toString()).toFixed(2),
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
      // one; a qty change on a Received return moves only the difference.
      // Decrements go through decreaseStock, which refuses to go below zero —
      // InsufficientStockError rolls the whole edit back. See
      // lib/purchase-stock.ts (and its tests) for the full rule.
      const after = { status: data.status, warehouseId: data.warehouseId, items: data.items };
      await applyStockDeltas(tx, purchaseStockDeltas(before, after, "out"), undefined);

      // Lines are replaced wholesale; nothing references PurchaseReturnItem ids.
      await tx.purchaseReturnItem.deleteMany({ where: { returnId: id } });
      await tx.purchaseReturnItem.createMany({
        data: documentItemsData(lines).map((item) => ({ ...item, returnId: id })),
      });

      previousProductIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return {
        ok: false,
        error: `Can't save — not enough stock for ${error.productName} in ${error.warehouseName} (have ${error.available}, this change takes out ${error.requested}).`,
      };
    }
    if (error instanceof DocumentChangedError) {
      return {
        ok: false,
        error: "This purchase return was changed or deleted by someone else. Reload the page and try again.",
      };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, [...previousProductIds, ...data.items.map((item) => item.productId)], id);
  return { ok: true, id, reference };
}

// Soft delete.
//
// Deleting a return undoes an outbound movement, so it ADDS the returned
// stock back to its warehouse (only if it was Received — Pending/Ordered never
// moved stock). This is the opposite of deleting a purchase, which REMOVES
// the stock the purchase added. Same reconciliation as an edit with nothing
// after it: purchaseStockDeltas(before, null, "out") yields only increases.
// Adding stock can't drive a balance negative, so unlike a purchase delete
// there is no "already sold" block here.
export async function deletePurchaseReturn(id: string): Promise<PurchaseActionState> {
  const authCheck = await requireManageReturns();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let productIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the return server-side; only its id came from the client.
      const before = await tx.purchaseReturn.findFirst({
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

      // Conditional on the state just read, and row-locks the return, so a
      // concurrent edit/delete can't add the stock back a second time.
      const { count } = await tx.purchaseReturn.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DocumentChangedError();

      await applyStockDeltas(tx, purchaseStockDeltas(before, null, "out"), undefined);

      productIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof DocumentChangedError) {
      return {
        ok: false,
        error: "This purchase return was changed or already deleted. Reload the page and try again.",
      };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, productIds, id);
  return { ok: true, id, reference };
}

// Read-only, so only a session is required — Manage Purchase Return is
// enforced on the save/delete mutations.
//
// Warehouse-scoped, unlike the purchase search: only products with stock > 0
// in the selected warehouse are offered, since you can only return what you
// hold. Their stock is shown and caps the line quantity in the form.
export async function searchProductsForReturn(
  warehouseId: string,
  query: string,
): Promise<PurchaseProductSearchResult[]> {
  if (!(await can(PERMISSIONS.MANAGE_PURCHASE_RETURN))) {
    return [];
  }
  return searchPurchaseProducts(warehouseId, query, { inStockOnly: true });
}
