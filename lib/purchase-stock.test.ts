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

// Purchase Returns: a Received return takes stock OUT — same reconciliation,
// opposite sign.
describe("purchaseStockDeltas — outbound (purchase returns)", () => {
  const out = (before: PurchaseStockState | null, after: PurchaseStockState | null) =>
    purchaseStockDeltas(before, after, "out").map(
      (d) => `${d.productId}@${d.warehouseId}:${d.delta > 0 ? "+" : ""}${d.delta}`,
    );

  test("create a Received return decrements every line", () => {
    assert.deepEqual(out(null, received("W1", [["A", 5], ["B", 2]])), ["A@W1:-5", "B@W1:-2"]);
  });

  test("create a Pending/Ordered return moves no stock", () => {
    assert.deepEqual(out(null, withStatus(received("W1", [["A", 5]]), "PENDING")), []);
    assert.deepEqual(out(null, withStatus(received("W1", [["A", 5]]), "ORDERED")), []);
  });

  test("Pending → Received decrements; Received → Pending restores", () => {
    const r = received("W1", [["A", 5]]);
    assert.deepEqual(out(withStatus(r, "PENDING"), r), ["A@W1:-5"]);
    assert.deepEqual(out(r, withStatus(r, "PENDING")), ["A@W1:+5"]);
  });

  test("Received qty change applies only the difference (more returned → more out)", () => {
    assert.deepEqual(out(received("W1", [["A", 5]]), received("W1", [["A", 8]])), ["A@W1:-3"]);
    assert.deepEqual(out(received("W1", [["A", 5]]), received("W1", [["A", 1]])), ["A@W1:+4"]);
  });

  test("warehouse change restores the old warehouse and decrements the new one", () => {
    assert.deepEqual(out(received("W1", [["A", 5]]), received("W2", [["A", 5]])), ["A@W2:-5", "A@W1:+5"]);
  });

  test("delete of a Received return adds the stock back; Pending is a no-op", () => {
    assert.deepEqual(out(received("W1", [["A", 5]]), null), ["A@W1:+5"]);
    assert.deepEqual(out(withStatus(received("W1", [["A", 5]]), "PENDING"), null), []);
  });

  test("decreases still come first", () => {
    assert.deepEqual(
      purchaseStockDeltas(received("W1", [["A", 1]]), received("W2", [["B", 1]]), "out").map((d) => d.delta),
      [-1, 1],
    );
  });
});

describe("purchaseStockDeltas — ordering (inbound)", () => {
  test("decreases are listed before increases", () => {
    const result = purchaseStockDeltas(received("W1", [["Z", 1]]), received("W2", [["A", 1]]));
    assert.deepEqual(
      result.map((d) => d.delta),
      [-1, 1],
    );
  });
});

// Sale Returns: stock comes back IN while Received or Completed.
describe("purchaseStockDeltas — sale returns (Received / Completed move stock)", () => {
  const ret = (status: PurchaseStockState["status"], items: [string, number][]): PurchaseStockState => ({
    status,
    warehouseId: "W1",
    items: items.map(([productId, quantity]) => ({ productId, quantity })),
  });
  const deltas = (before: PurchaseStockState | null, after: PurchaseStockState | null) =>
    purchaseStockDeltas(before, after, "in").map((d) => `${d.productId}:${d.delta > 0 ? "+" : ""}${d.delta}`);

  test("create Completed adds stock, like Received; Pending adds none", () => {
    assert.deepEqual(deltas(null, ret("COMPLETED", [["A", 2]])), ["A:+2"]);
    assert.deepEqual(deltas(null, ret("RECEIVED", [["A", 2]])), ["A:+2"]);
    assert.deepEqual(deltas(null, ret("PENDING", [["A", 2]])), []);
  });

  test("Received ↔ Completed moves nothing (both hold the stock)", () => {
    assert.deepEqual(deltas(ret("RECEIVED", [["A", 2]]), ret("COMPLETED", [["A", 2]])), []);
    assert.deepEqual(deltas(ret("COMPLETED", [["A", 2]]), ret("RECEIVED", [["A", 2]])), []);
  });

  test("Completed → Pending takes the stock back out; delete of a Completed return removes it", () => {
    assert.deepEqual(deltas(ret("COMPLETED", [["A", 2]]), ret("PENDING", [["A", 2]])), ["A:-2"]);
    assert.deepEqual(deltas(ret("COMPLETED", [["A", 2]]), null), ["A:-2"]);
  });
});
