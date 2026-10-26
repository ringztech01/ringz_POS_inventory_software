import type { PurchaseStatus, SaleReturnStatus } from "@prisma/client";

// Stock reconciliation for purchases.
//
// Sale Returns (direction "in") hold their stock while RECEIVED or COMPLETED.
//
// A purchase only puts stock in a warehouse while its status is RECEIVED:
// its "received contribution" is each line's quantity, in its warehouse, if
// RECEIVED — and nothing at all if PENDING or ORDERED.
//
// Saving an edit must NOT re-run the create logic (that would add the
// quantities a second time). Instead we compare what the purchase contributed
// before the edit with what it contributes after, per (product, warehouse):
//
//   delta = newReceived − oldReceived
//
// and apply only that delta through lib/stock.ts. This one rule covers every
// case:
//   - Pending → Received          adds every line           (old = 0)
//   - Received → Pending/Ordered  reverses every line       (new = 0)
//   - Received, qty 5 → 8         adds 3; 5 → 1 removes 4
//   - line added / removed        adds / reverses that line
//   - warehouse W1 → W2           reverses in W1, adds in W2 (different keys)
//   - Pending ↔ Ordered           no movement
// A delete is the same computation with nothing after it (new = 0).
//
// Purchase Returns use the same rule with direction "out": a Received return
// takes its quantities OUT of the warehouse, so every delta is negated —
//   - create Received              decrements every line    (oldOut = 0)
//   - Pending → Received           decrements
//   - Received → Pending/Ordered   restores (adds back)
//   - warehouse W1 → W2            restores W1, decrements W2
//   - delete a Received return     adds the stock back
// i.e. stock delta = −(newOut − oldOut).
//
// A negative delta can fail if that stock has since been sold or moved (or,
// for a return, was never there); lib/stock.ts's decreaseStock refuses to go
// below zero and the caller's transaction rolls back.

export type PurchaseStockState = {
  status: PurchaseStatus | SaleReturnStatus;
  warehouseId: string;
  items: { productId: string; quantity: number }[];
};

export type StockDelta = { productId: string; warehouseId: string; delta: number };

const key = (productId: string, warehouseId: string) => `${productId}\u0000${warehouseId}`;

function receivedQuantities(state: PurchaseStockState | null): Map<string, StockDelta> {
  const result = new Map<string, StockDelta>();
  // Received — or a sale return's Completed — holds the stock.
  if (!state || (state.status !== "RECEIVED" && state.status !== "COMPLETED")) return result;
  for (const item of state.items) {
    const k = key(item.productId, state.warehouseId);
    const entry = result.get(k) ?? { productId: item.productId, warehouseId: state.warehouseId, delta: 0 };
    entry.delta += item.quantity;
    result.set(k, entry);
  }
  return result;
}

// Non-zero stock movements needed to go from `before` to `after` (null =
// the document doesn't exist / is deleted). `direction` is which way a
// Received document moves stock: "in" (Purchase) or "out" (Purchase Return).
// Decreases come first so a transaction fails fast before doing any increases.
export function purchaseStockDeltas(
  before: PurchaseStockState | null,
  after: PurchaseStockState | null,
  direction: "in" | "out" = "in",
): StockDelta[] {
  const oldReceived = receivedQuantities(before);
  const newReceived = receivedQuantities(after);
  const sign = direction === "in" ? 1 : -1;
  const deltas: StockDelta[] = [];

  for (const k of new Set([...oldReceived.keys(), ...newReceived.keys()])) {
    const ref = newReceived.get(k) ?? oldReceived.get(k)!;
    const delta = sign * ((newReceived.get(k)?.delta ?? 0) - (oldReceived.get(k)?.delta ?? 0));
    if (delta !== 0) deltas.push({ productId: ref.productId, warehouseId: ref.warehouseId, delta });
  }

  return deltas.sort((a, b) => Math.sign(a.delta) - Math.sign(b.delta));
}
