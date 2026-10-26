// Run with: npx tsx --test lib/transfer-stock.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { transferMoves, transferReconcileMoves, type StockMove, type TransferStockState } from "./transfer-stock";

const state = (status: TransferStockState["status"]): TransferStockState => ({
  status,
  fromWarehouseId: "W1",
  toWarehouseId: "W2",
  items: [
    { productId: "A", quantity: 5 },
    { productId: "B", quantity: 2 },
  ],
});
const show = (s: TransferStockState | null) =>
  transferMoves(s).map((m) => `${m.productId}:${m.fromWarehouseId}→${m.toWarehouseId}×${m.quantity}`);

describe("transferMoves (in-transit rule)", () => {
  test("Completed moves every line From → To", () => {
    assert.deepEqual(show(state("COMPLETED")), ["A:W1→W2×5", "B:W1→W2×2"]);
  });

  test("Sent and Pending move nothing", () => {
    assert.deepEqual(show(state("SENT")), []);
    assert.deepEqual(show(state("PENDING")), []);
  });

  test("no transfer → no moves", () => {
    assert.deepEqual(show(null), []);
  });
});

// Edit reconciliation. `t(status, from, to, lines)` builds a transfer state.
const t = (
  status: TransferStockState["status"],
  from: string,
  to: string,
  lines: [string, number][],
): TransferStockState => ({
  status,
  fromWarehouseId: from,
  toWarehouseId: to,
  items: lines.map(([productId, quantity]) => ({ productId, quantity })),
});
const fmt = (moves: StockMove[]) =>
  moves.map((m) => `${m.kind}:${m.productId}:${m.fromWarehouseId}→${m.toWarehouseId}×${m.quantity}`);
const reconcile = (before: TransferStockState | null, after: TransferStockState | null) =>
  fmt(transferReconcileMoves(before, after));

// Net stock change per product@warehouse of a list of moves.
function net(moves: StockMove[]) {
  const totals = new Map<string, number>();
  const add = (key: string, qty: number) => {
    totals.set(key, (totals.get(key) ?? 0) + qty);
    if (totals.get(key) === 0) totals.delete(key);
  };
  for (const m of moves) {
    add(`${m.productId}@${m.fromWarehouseId}`, -m.quantity);
    add(`${m.productId}@${m.toWarehouseId}`, m.quantity);
  }
  return Object.fromEntries([...totals].sort());
}
// The naive rule: reverse every old move, then apply every new one.
const naive = (before: TransferStockState | null, after: TransferStockState | null) => [
  ...transferMoves(before).map((m) => ({ ...m, fromWarehouseId: m.toWarehouseId, toWarehouseId: m.fromWarehouseId })),
  ...transferMoves(after),
];

describe("transferReconcileMoves (edit)", () => {
  test("nothing changed on a Completed transfer → no moves (e.g. only the note edited)", () => {
    const s = t("COMPLETED", "W1", "W2", [["A", 5]]);
    assert.deepEqual(reconcile(s, s), []);
  });

  test("qty up / down on the same route moves only the difference", () => {
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), t("COMPLETED", "W1", "W2", [["A", 8]])), [
      "apply:A:W1→W2×3",
    ]);
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), t("COMPLETED", "W1", "W2", [["A", 2]])), [
      "reverse:A:W2→W1×3",
    ]);
  });

  test("line removed reverses it; line added applies it", () => {
    assert.deepEqual(
      reconcile(t("COMPLETED", "W1", "W2", [["A", 5], ["B", 2]]), t("COMPLETED", "W1", "W2", [["A", 5], ["C", 4]])),
      ["reverse:B:W2→W1×2", "apply:C:W1→W2×4"],
    );
  });

  test("Completed → Sent/Pending reverses everything; Pending → Completed applies everything", () => {
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), t("SENT", "W1", "W2", [["A", 5]])), [
      "reverse:A:W2→W1×5",
    ]);
    assert.deepEqual(reconcile(t("PENDING", "W1", "W2", [["A", 5]]), t("COMPLETED", "W1", "W2", [["A", 5]])), [
      "apply:A:W1→W2×5",
    ]);
  });

  test("Pending/Sent ↔ Pending/Sent never moves stock", () => {
    assert.deepEqual(reconcile(t("PENDING", "W1", "W2", [["A", 5]]), t("SENT", "W1", "W3", [["A", 9]])), []);
  });

  test("To changed: reverse out of the old To, apply into the new To", () => {
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), t("COMPLETED", "W1", "W3", [["A", 5]])), [
      "reverse:A:W2→W1×5",
      "apply:A:W1→W3×5",
    ]);
  });

  test("From/To swapped: both moves run (old To must hold it twice over)", () => {
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), t("COMPLETED", "W2", "W1", [["A", 5]])), [
      "reverse:A:W2→W1×5",
      "apply:A:W2→W1×5",
    ]);
  });

  test("delete (after = null) of a Completed transfer moves it back To → From", () => {
    assert.deepEqual(reconcile(t("COMPLETED", "W1", "W2", [["A", 5]]), null), ["reverse:A:W2→W1×5"]);
    assert.deepEqual(reconcile(t("SENT", "W1", "W2", [["A", 5]]), null), []);
  });

  test("reverses come before applies", () => {
    const kinds = transferReconcileMoves(
      t("COMPLETED", "W1", "W2", [["A", 5], ["B", 5]]),
      t("COMPLETED", "W1", "W2", [["A", 9], ["B", 1]]),
    ).map((m) => m.kind);
    assert.deepEqual(kinds, ["reverse", "apply"]);
  });

  test("always the same final stock as plain reverse-then-apply", () => {
    const states: (TransferStockState | null)[] = [
      null,
      t("COMPLETED", "W1", "W2", [["A", 5], ["B", 2]]),
      t("COMPLETED", "W1", "W2", [["A", 8]]),
      t("COMPLETED", "W1", "W3", [["A", 5], ["C", 1]]),
      t("COMPLETED", "W2", "W1", [["B", 2]]),
      t("SENT", "W1", "W2", [["A", 5]]),
      t("PENDING", "W2", "W3", [["C", 3]]),
    ];
    for (const before of states) {
      for (const after of states) {
        assert.deepEqual(net(transferReconcileMoves(before, after)), net(naive(before, after)));
      }
    }
  });

  test("a transfer never changes total system stock", () => {
    const moves = transferReconcileMoves(
      t("COMPLETED", "W1", "W2", [["A", 5]]),
      t("COMPLETED", "W3", "W1", [["A", 7], ["B", 1]]),
    );
    const total = Object.values(net(moves)).reduce((sum, qty) => sum + qty, 0);
    assert.equal(total, 0);
  });
});
