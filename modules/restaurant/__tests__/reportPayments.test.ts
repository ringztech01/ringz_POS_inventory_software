// Restaurant Reports, Step 6: payments by method, tips, refund totals.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { methodLines, refundTotals, tipLines } from "../lib/reportPayments";

describe("Payments & tips", () => {
  test("every method, always; the share of the total", () => {
    const { lines, totals } = methodLines([
      { method: "CASH", count: 3, amount: "150.00" },
      { method: "CARD", count: 2, amount: "50.00" },
    ]);
    assert.deepEqual(lines.map((l) => [l.method, l.count, l.amount, l.share]), [
      ["CASH", 3, "150.00", 75],
      ["CARD", 2, "50.00", 25],
      ["BANK_TRANSFER", 0, "0.00", 0],
      ["CHEQUE", 0, "0.00", 0],
    ]);
    assert.deepEqual(totals, { count: 5, amount: "200.00" });
    assert.deepEqual(methodLines([]).lines.map((l) => l.share), [null, null, null, null], "nothing paid: no shares");
  });

  test("tips by waiter", () => {
    const { lines, totals } = tipLines(
      [
        { userId: "ada", count: 2, amount: "7.5" },
        { userId: "gone", count: 1, amount: "2" },
      ],
      new Map([["ada", "Ada"]]),
    );
    assert.deepEqual(lines.map((l) => [l.name, l.count, l.amount]), [["Ada", 2, "7.50"], ["Deleted user", 1, "2.00"]]);
    assert.deepEqual(totals, { count: 3, amount: "9.50" });
  });

  test("refunds: how many, how much, how many back to stock", () => {
    const row = (id: string, amount: string, toStock: boolean) => ({ id, reference: id, at: new Date(), sale: "SL-1", orderNumber: 1, amount, methods: ["CASH" as const], by: "Ada", toStock });
    assert.deepEqual(refundTotals([row("a", "10.00", true), row("b", "5.50", false)]), { count: 2, amount: "15.50", toStock: 1 });
  });
});
