// Run with: npx tsx --test lib/purchase-stock.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { purchaseStockDeltas, type PurchaseStockState } from "./purchase-stock";

const received = (warehouseId: string, items: [string, number][]): PurchaseStockState => ({
  status: "RECEIVED",
  warehouseId,
  items: items.map(([productId, quantity]) => ({ productId, quantity })),
});
const withStatus = (state: PurchaseStockState, status: PurchaseStockState["status"]) => ({ ...state, status });

function deltas(before: PurchaseStockState | null, after: PurchaseStockState | null) {
  return purchaseStockDeltas(before, after).map((d) => `${d.productId}@${d.warehouseId}:${d.delta > 0 ? "+" : ""}${d.delta}`);
}

describe("purchaseStockDeltas", () => {
  test("no change → no stock movement", () => {
    const state = received("W1", [["A", 5], ["B", 2]]);
    assert.deepEqual(deltas(state, state), []);
  });

  test("Pending → Received adds the full quantities", () => {
    const after = received("W1", [["A", 5], ["B", 2]]);
    assert.deepEqual(deltas(withStatus(after, "PENDING"), after), ["A@W1:+5", "B@W1:+2"]);
  });

  test("Received → Pending reverses the full quantities", () => {
    const before = received("W1", [["A", 5], ["B", 2]]);
    assert.deepEqual(deltas(before, withStatus(before, "PENDING")), ["A@W1:-5", "B@W1:-2"]);
  });

  test("Pending ↔ Ordered never touches stock", () => {
    const pending = withStatus(received("W1", [["A", 5]]), "PENDING");
    assert.deepEqual(deltas(pending, withStatus(pending, "ORDERED")), []);
    assert.deepEqual(deltas(withStatus(pending, "ORDERED"), pending), []);
  });

  test("Received → Received applies only the quantity difference", () => {
    assert.deepEqual(deltas(received("W1", [["A", 5]]), received("W1", [["A", 8]])), ["A@W1:+3"]);
    assert.deepEqual(deltas(received("W1", [["A", 5]]), received("W1", [["A", 1]])), ["A@W1:-4"]);
  });

  test("adding and removing lines on a Received purchase", () => {
    assert.deepEqual(deltas(received("W1", [["A", 5], ["B", 2]]), received("W1", [["A", 5], ["C", 7]])), [
      "B@W1:-2",
      "C@W1:+7",
    ]);
  });

  test("warehouse change moves the stock: reverse in the old warehouse, add in the new one", () => {
    assert.deepEqual(deltas(received("W1", [["A", 5]]), received("W2", [["A", 5]])), ["A@W1:-5", "A@W2:+5"]);
  });

  test("warehouse change combined with a quantity change", () => {
    assert.deepEqual(deltas(received("W1", [["A", 5]]), received("W2", [["A", 3]])), ["A@W1:-5", "A@W2:+3"]);
  });

  test("warehouse change while Pending → Received only adds to the new warehouse", () => {
    const before = withStatus(received("W1", [["A", 5]]), "PENDING");
    assert.deepEqual(deltas(before, received("W2", [["A", 5]])), ["A@W2:+5"]);
  });

  test("delete (after = null) reverses a Received purchase and is a no-op otherwise", () => {
    assert.deepEqual(deltas(received("W1", [["A", 5]]), null), ["A@W1:-5"]);
    assert.deepEqual(deltas(withStatus(received("W1", [["A", 5]]), "ORDERED"), null), []);
  });

  test("decreases are listed before increases (fail fast inside the transaction)", () => {
    const result = purchaseStockDeltas(received("W1", [["Z", 1]]), received("W2", [["A", 1]]));
    assert.deepEqual(
      result.map((d) => d.delta),
      [-1, 1],
    );
  });
});
