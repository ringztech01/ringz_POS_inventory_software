"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { can, requirePermission } from "@/lib/auth/permissions.server";
import { generateReference } from "@/lib/reference";
import { InsufficientStockError, moveStock } from "@/lib/stock";
import { transferMoves, transferReconcileMoves, type StockMove } from "@/lib/transfer-stock";
import { transferSchema, type TransferInput } from "@/lib/validations/transfer";
import {
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
} from "../purchases/document-actions";
import { searchPurchaseProducts } from "../purchases/product-search";
import type { PurchaseActionState, PurchaseProductSearchResult } from "../purchases/types";

const LIST_PATH = "/transfers";
const requireManageTransfers = () => requirePermission(PERMISSIONS.MANAGE_TRANSFERS);

// The shared line rows use purchase column names; TransferItem calls the
// unit transferUnit (netUnitCost is the same).
function transferItemsData(lines: Pick<Loaded, "lines">["lines"]) {
  return documentItemsData(lines).map(({ purchaseUnit, ...rest }) => ({ ...rest, transferUnit: purchaseUnit }));
}

// A move a warehouse couldn't cover. `kind` "apply" = the transfer's own move
// (From short); "reverse" = undoing an earlier move (the old To no longer
// holds what was moved there — e.g. it was sold since).
class TransferMoveError extends Error {
  constructor(
    public readonly kind: "apply" | "reverse",
    public readonly stock: InsufficientStockError,
  ) {
    super(stock.message);
  }
}

// Applies moves through the stock service, one moveStock per move, in order
// (reverses before applies). Any move a warehouse can't cover throws
// TransferMoveError → the caller's transaction rolls back with no changes.
async function applyMoves(tx: Prisma.TransactionClient, moves: StockMove[]) {
  if (moves.length === 0) return;

  const [products, warehouses] = await Promise.all([
    tx.product.findMany({ where: { id: { in: moves.map((m) => m.productId) } }, select: { id: true, name: true } }),
    tx.warehouse.findMany({
      where: { id: { in: moves.flatMap((m) => [m.fromWarehouseId, m.toWarehouseId]) } },
      select: { id: true, name: true },
    }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));

  for (const move of moves) {
    try {
      await moveStock(tx, move.productId, move.fromWarehouseId, move.toWarehouseId, move.quantity, {
        productName: productName.get(move.productId) ?? "A product",
        fromName: warehouseName.get(move.fromWarehouseId) ?? "the warehouse",
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) throw new TransferMoveError(move.kind ?? "apply", error);
      throw error;
    }
  }
}

// Re-reads both warehouses and every product server-side and recomputes
// every line and the grand total with lib/pricing.ts (loadDocument). Client
// names, stock and totals are never used. `existing` (edit): the transfer's
// own warehouses/products stay valid even if soft-deleted since.
async function loadTransfer(
  data: TransferInput,
  existing?: { fromWarehouseId: string; toWarehouseId: string; productIds: string[] },
) {
  const [loaded, toWarehouse] = await Promise.all([
    loadDocument({ ...data, warehouseId: data.fromWarehouseId }, "", {
      party: null,
      existing: existing
        ? { warehouseId: existing.fromWarehouseId, partyId: "", productIds: existing.productIds }
        : undefined,
    }),
    prisma.warehouse.findFirst({
      where: {
        id: data.toWarehouseId,
        OR: [{ deletedAt: null }, ...(existing ? [{ id: existing.toWarehouseId }] : [])],
      },
      select: { id: true, name: true },
    }),
  ]);
  if (loaded.kind === "invalid") {
    // loadDocument reports the (From) warehouse as warehouseId.
    const { warehouseId, ...rest } = loaded.state.fieldErrors ?? {};
    return { kind: "invalid" as const, state: { ...loaded.state, fieldErrors: warehouseId ? { ...rest, fromWarehouseId: warehouseId } : rest } };
  }
  if (!toWarehouse) {
    return { kind: "invalid" as const, state: invalid({ toWarehouseId: ["Warehouse not found."] }) };
  }

  const { data: loadedData, lines, order, warehouse: fromWarehouse } = loaded;
  // documentOrderData's warehouseId is the From warehouse.
  const { warehouseId: fromWarehouseId, ...header } = documentOrderData(
    { ...loadedData, warehouseId: fromWarehouse.id },
    order,
  );
  const state = { status: loadedData.status, fromWarehouseId, toWarehouseId: toWarehouse.id, items: loadedData.items };
  return { kind: "ok" as const, header, lines, state };
}

function moveErrorMessage(error: TransferMoveError, action: "save" | "delete"): string {
  const { productName, warehouseName, available, requested } = error.stock;
  if (error.kind === "apply") {
    return `Not enough stock for ${productName} in ${warehouseName} (have ${available}, moving ${requested}).`;
  }
  return action === "delete"
    ? `Can't delete — ${productName} stock in ${warehouseName} is lower than this transfer moved.`
    : `Can't save — ${productName} stock in ${warehouseName} is lower than this transfer moved there (have ${available}, needs ${requested} back).`;
}

export async function createTransfer(input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageTransfers();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // zod: From ≠ To (field error on To), date, status, ≥ 1 item, qty ≥ 1,
  // each product once.
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  const loaded = await loadTransfer(parsed.data);
  if (loaded.kind === "invalid") return loaded.state;
  const { header, lines, state } = loaded;

  // One transaction: TR_ reference, the transfer + its items, and — only when
  // Completed — one moveStock per line (From −qty, To +qty, same qty).
  // In-transit rule: Sent and Pending save the document only; no stock moves
  // until the transfer is Completed (lib/transfer-stock.ts).
  //
  // References are random (shared prefix generator); the unique index on
  // Transfer.reference makes this race-safe — a collision rolls back and
  // retries.
  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const transfer = await tx.transfer.create({
          data: {
            ...header,
            fromWarehouseId: state.fromWarehouseId,
            toWarehouseId: state.toWarehouseId,
            reference: generateReference("TR"),
            createdById: authCheck.userId,
            items: { create: transferItemsData(lines) },
          },
          select: { id: true, reference: true },
        });

        await applyMoves(tx, transferMoves(state));

        return transfer;
      });

      revalidateDocumentPaths(
        LIST_PATH,
        state.items.map((item) => item.productId),
      );
      return { ok: true, id: created.id, reference: created.reference };
    } catch (error) {
      if (error instanceof TransferMoveError) return { ok: false, error: moveErrorMessage(error, "save") };
      if (isReferenceCollision(error)) {
        if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
}

// ------------------------------------------------------------------- Edit

export async function updateTransfer(id: string, input: unknown): Promise<PurchaseActionState> {
  const authCheck = await requireManageTransfers();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the transfer server-side; the id is the only thing taken from the
  // client (and the page binds it — the form never sends it).
  const current = await prisma.transfer.findFirst({
    where: { id, deletedAt: null },
    select: { fromWarehouseId: true, toWarehouseId: true, items: { select: { productId: true } } },
  });
  if (!current) {
    return { ok: false, error: "Transfer not found. It may have been deleted." };
  }

  // From ≠ To re-validated (zod); totals recomputed server-side.
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return invalid(toFieldErrors(parsed.error));
  }

  const loaded = await loadTransfer(parsed.data, {
    fromWarehouseId: current.fromWarehouseId,
    toWarehouseId: current.toWarehouseId,
    productIds: current.items.map((item) => item.productId),
  });
  if (loaded.kind === "invalid") return loaded.state;
  const { header, lines, state: after } = loaded;

  let previousProductIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // The "before" state, read inside the transaction.
      const before = await tx.transfer.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          fromWarehouseId: true,
          toWarehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new DocumentChangedError();

      // Header update only if the transfer is unchanged since `before`; the
      // UPDATE also row-locks it, so two concurrent edits can't both
      // reconcile against the same "before".
      const { count } = await tx.transfer.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { ...header, fromWarehouseId: after.fromWarehouseId, toWarehouseId: after.toWarehouseId },
      });
      if (count === 0) throw new DocumentChangedError();

      // STOCK RECONCILIATION across both warehouses — never re-run create's
      // move on its own (that would move the goods twice). Instead:
      //   1. reverse the old effect: if the old status was Completed, every
      //      old line moves back oldTo → oldFrom (blocked if oldTo no longer
      //      holds it, e.g. the goods were sold there since);
      //   2. apply the new effect: if the new status is Completed, every new
      //      line moves newFrom → newTo (blocked if newFrom is short).
      // Lines on an unchanged route are netted to their difference (same
      // final stock, fewer writes — see transferReconcileMoves). Both steps
      // run in this one transaction, so qty changes, added/removed lines,
      // status changes and From/To changes all reconcile consistently, and
      // any failure rolls the whole edit back.
      await applyMoves(tx, transferReconcileMoves(before, after));

      // Nothing references TransferItem ids, so lines are replaced.
      await tx.transferItem.deleteMany({ where: { transferId: id } });
      await tx.transferItem.createMany({ data: transferItemsData(lines).map((item) => ({ ...item, transferId: id })) });

      previousProductIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof TransferMoveError) return { ok: false, error: moveErrorMessage(error, "save") };
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This transfer was changed or deleted by someone else. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, [...previousProductIds, ...after.items.map((item) => item.productId)], id);
  return { ok: true, id, reference };
}

// ----------------------------------------------------------------- Delete

// Soft delete.
//
// Deleting a transfer undoes its move, so stock flows the opposite way:
// To → From. Only a Completed transfer moved stock (in-transit rule), so only
// then does each line run moveStock(tx, product, to, from, qty) — taking it
// back out of To and adding it back to From. Total system stock stays
// unchanged. If To no longer holds the qty (e.g. sold since), that move
// fails and the delete is refused with nothing changed. Sent/Pending
// transfers moved nothing, so deleting them moves nothing.
export async function deleteTransfer(id: string): Promise<PurchaseActionState> {
  const authCheck = await requireManageTransfers();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  let productIds: string[] = [];
  let reference = "";

  try {
    await prisma.$transaction(async (tx) => {
      // Re-read the transfer server-side; only its id came from the client.
      const before = await tx.transfer.findFirst({
        where: { id, deletedAt: null },
        select: {
          reference: true,
          status: true,
          fromWarehouseId: true,
          toWarehouseId: true,
          updatedAt: true,
          items: { select: { productId: true, quantity: true } },
        },
      });
      if (!before) throw new DocumentChangedError();

      // Conditional on the state just read, and row-locks the transfer, so a
      // concurrent edit/delete can't move the stock back a second time.
      const { count } = await tx.transfer.updateMany({
        where: { id, deletedAt: null, updatedAt: before.updatedAt },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DocumentChangedError();

      // Reconciling to "no transfer" = reversing every Completed line.
      await applyMoves(tx, transferReconcileMoves(before, null));

      productIds = before.items.map((item) => item.productId);
      reference = before.reference;
    });
  } catch (error) {
    if (error instanceof TransferMoveError) return { ok: false, error: moveErrorMessage(error, "delete") };
    if (error instanceof DocumentChangedError) {
      return { ok: false, error: "This transfer was changed or already deleted. Reload the page and try again." };
    }
    throw error;
  }

  revalidateDocumentPaths(LIST_PATH, productIds, id);
  return { ok: true, id, reference };
}

// Read-only, so only a session is required — Manage Transfers is enforced on
// the mutations. Scoped to the From warehouse: only products with stock > 0
// there (you can only move what it holds), with that stock shown.
export async function searchProductsForTransfer(
  fromWarehouseId: string,
  query: string,
): Promise<PurchaseProductSearchResult[]> {
  if (!(await can(PERMISSIONS.MANAGE_TRANSFERS))) {
    return [];
  }
  return searchPurchaseProducts(fromWarehouseId, query, { inStockOnly: true });
}
