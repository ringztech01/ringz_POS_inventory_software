// Restaurant Reports, Step 4: By waiter put together, and the report
// tables' sort.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatHours, waiterLines } from "../lib/reportWaiters";
import { sortRows, type SortableRow } from "../components/reports/SortableTable";

const names = new Map([
  ["ada", "Ada"],
  ["tayo", "Tayo"],
  ["mona", "Mona"],
]);

const report = () =>
  waiterLines({
    orders: [
      { userId: "ada", orders: 4, covers: 9, sales: "200.00", tableSeconds: 4 * 3600 },
      { userId: "tayo", orders: 1, covers: 2, sales: "50.00", tableSeconds: 1800 },
      { userId: null, orders: 1, covers: 1, sales: "10.00", tableSeconds: 600 },
    ],
    refunds: [{ userId: "ada", amount: "20.00" }],
    tips: [{ userId: "ada", amount: "15.00" }],
    // Mona (a manager) put a discount on one of Ada's bills.
    discounts: [{ userId: "mona", count: 1, amount: "5.00" }],
    voids: [{ userId: "tayo", count: 2, amount: "18.00" }],
    overrides: [{ userId: "tayo", count: 1 }],
    shifts: [{ userId: "ada", seconds: 6 * 3600 }],
    names,
  });

describe("By waiter", () => {
  test("each person's figures", () => {
    const by = Object.fromEntries(report().lines.map((l) => [l.userId ?? "none", l]));
    assert.deepEqual([by.ada.orders, by.ada.covers, by.ada.net, by.ada.averageBill, by.ada.tips], [4, 9, "180.00", "50.00", "15.00"], "net less refunds; average bill on the bills as settled");
    assert.deepEqual([by.ada.averageTableSeconds, by.ada.shiftSeconds, by.ada.salesPerHour], [3600, 21600, "30.00"]);
    assert.deepEqual([by.tayo.voids, by.tayo.voidValue, by.tayo.overrides, by.tayo.shiftSeconds, by.tayo.salesPerHour], [2, "18.00", 1, null, null], "no shift: no sales per hour");
    assert.deepEqual([by.mona.orders, by.mona.discounts, by.mona.discountAmount, by.mona.averageBill, by.mona.averageTableSeconds], [0, 1, "5.00", null, null], "a manager who only discounted");
    assert.equal(by.none.name, "No waiter");
  });

  test("the total row", () => {
    const { totals } = report();
    assert.deepEqual([totals.orders, totals.covers, totals.net, totals.averageBill, totals.tips, totals.discounts, totals.voids, totals.overrides], [6, 12, "240.00", "43.33", "15.00", 1, 2, 1]);
    // (4h + 30m + 10m) / 6 orders; sales per hour only over those with shifts.
    assert.deepEqual([totals.averageTableSeconds, totals.shiftSeconds, totals.salesPerHour], [2800, 21600, "30.00"]);
  });

  test("hours", () => {
    assert.equal(formatHours(4500), "1.3 h");
    assert.equal(formatHours(28800), "8.0 h");
  });
});

describe("the report tables' sort", () => {
  const row = (id: string, net: number | null, name: string): SortableRow => ({ id, cells: { name }, sort: { name, net } });
  const rows = [row("a", 10, "Zara"), row("b", null, "Ade"), row("c", 30, "Bola"), row("d", 10, "Ayo")];
  test("either way; unknown last; ties by the first column", () => {
    assert.deepEqual(sortRows(rows, "net", "desc", "name").map((r) => r.id), ["c", "d", "a", "b"]);
    assert.deepEqual(sortRows(rows, "net", "asc", "name").map((r) => r.id), ["d", "a", "c", "b"]);
    assert.deepEqual(sortRows(rows, "name", "asc", "name").map((r) => r.id), ["b", "d", "c", "a"]);
  });
});
