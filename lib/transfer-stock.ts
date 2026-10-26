import type { TransferStatus } from "@prisma/client";

// Stock rules for transfers (pure — applied through lib/stock.ts's moveStock).
//
// In-transit rule: a transfer moves stock From → To only while its status is
// COMPLETED. PENDING and SENT move nothing — the goods count as still in
// From until the transfer is completed. One rule for create, edit and delete
// keeps their reconciliation symmetric and never creates phantom stock (an
// amount gone from From but not yet in To).

export type TransferStockState = {
  status: TransferStatus;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: { productId: string; quantity: number }[];
};

// `kind` says why a move happens: "apply" makes the transfer's own move
// (From → To); "reverse" undoes an earlier one (To → From). Callers use it to
// word the error when a warehouse can't cover the move.
export type StockMove = {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  kind?: "apply" | "reverse";
};

// The moves a transfer in this state has made: one per line if COMPLETED,
// none otherwise (or if it doesn't exist).
export function transferMoves(state: TransferStockState | null): StockMove[] {
  if (!state || state.status !== "COMPLETED") return [];
  return state.items.map((item) => ({
    productId: item.productId,
    fromWarehouseId: state.fromWarehouseId,
    toWarehouseId: state.toWarehouseId,
    quantity: item.quantity,
    kind: "apply" as const,
  }));
}

// Undoing a move is a move in the opposite direction.
const reverse = (move: StockMove): StockMove => ({
  ...move,
  fromWarehouseId: move.toWarehouseId,
  toWarehouseId: move.fromWarehouseId,
  kind: "reverse",
});

// EDIT RECONCILIATION — the moves that take stock from what `before` did to
// what `after` does. Never re-run create's move on its own (that would move
// the goods twice). Conceptually:
//
//   1. Reverse the old effect: if before was COMPLETED, every old line moves
//      back oldTo → oldFrom (oldTo must still hold it — if the goods were
//      sold there since, that move fails and the edit is blocked).
//   2. Apply the new effect: if after is COMPLETED, every new line moves
//      newFrom → newTo (newFrom must hold it).
//
// That one rule covers qty changes, added/removed lines, status changes and
// From/To changes. As an optimisation, a product moved on the SAME route
// (same From and To, Completed before and after) is netted: only the
// difference moves (more → From→To, less → To→From, same → nothing). The
// final stock is identical to reverse-then-apply; it just skips no-op
// writes — so e.g. editing only the note of a Completed transfer whose goods
// were since sold at To isn't blocked.
//
// Reverses come first (as in the two steps above), then applies.
export function transferReconcileMoves(
  before: TransferStockState | null,
  after: TransferStockState | null,
): StockMove[] {
  const oldMoves = transferMoves(before);
  const newMoves = transferMoves(after);
  const sameRoute =
    oldMoves.length > 0 &&
    newMoves.length > 0 &&
    before!.fromWarehouseId === after!.fromWarehouseId &&
    before!.toWarehouseId === after!.toWarehouseId;

  if (!sameRoute) {
    return [...oldMoves.map(reverse), ...newMoves];
  }

  const oldQty = new Map(oldMoves.map((move) => [move.productId, move.quantity]));
  const newQty = new Map(newMoves.map((move) => [move.productId, move.quantity]));
  const route = { fromWarehouseId: after!.fromWarehouseId, toWarehouseId: after!.toWarehouseId };
  const reverses: StockMove[] = [];
  const applies: StockMove[] = [];

  for (const productId of new Set([...oldQty.keys(), ...newQty.keys()])) {
    const diff = (newQty.get(productId) ?? 0) - (oldQty.get(productId) ?? 0);
    if (diff > 0) applies.push({ productId, ...route, quantity: diff, kind: "apply" });
    if (diff < 0) reverses.push(reverse({ productId, ...route, quantity: -diff }));
  }
  return [...reverses, ...applies];
}
