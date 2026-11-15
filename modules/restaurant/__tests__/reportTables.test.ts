// Restaurant Reports, Step 5: By table (with area subtotals and the heat
// map's shares) and By order type.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { heatOf, tableLines, typeLines } from "../lib/reportTables";

const INFO = [
  { tableId: "t1", name: "T1", areaId: "main", area: "Main hall", deleted: false },
  { tableId: "t2", name: "T2", areaId: "main", area: "Main hall", deleted: false },
  { tableId: "p1", name: "P1", areaId: "patio", area: "Patio", deleted: false },
];

// A 7-day period.
const report = () =>
  tableLines({
    orders: [
      { tableId: "t1", orders: 14, covers: 40, sales: "700.00", seconds: 14 * 3000 },
      { tableId: "t2", orders: 7, covers: 14, sales: "210.00", seconds: 7 * 1800 },
      { tableId: "p1", orders: 3, covers: 6, sales: "90.00", seconds: 3 * 3600 },
    ],
    refunds: [{ tableId: "t1", amount: "50.00" }],
    info: INFO,
    days: 7,
  });

describe("By table", () => {
  test("each table: net (less refunds), average bill, turn time, turns per day", () => {
    const by = Object.fromEntries(report().lines.map((l) => [l.tableId, l]));
    assert.deepEqual([by.t1.net, by.t1.averageBill, by.t1.averageTurnSeconds, by.t1.turnsPerDay], ["650.00", "50.00", 3000, 2]);
    assert.deepEqual([by.t2.turnsPerDay, by.p1.turnsPerDay, by.p1.area], [1, 0.4, "Patio"]);
  });

  test("area subtotals; an area's turns are its tables' average", () => {
    const { areas, totals } = report();
    assert.deepEqual(areas.map((a) => [a.area, a.totals.orders, a.totals.net, a.totals.turnsPerDay]), [
      ["Main hall", 21, "860.00", 1.5],
      ["Patio", 3, "90.00", 0.4],
    ]);
    assert.deepEqual([totals.orders, totals.covers, totals.net, totals.averageBill], [24, 60, "950.00", "41.67"]);
  });

  test("a table that's gone still shows", () => {
    const { lines } = tableLines({ orders: [{ tableId: "x", orders: 1, covers: 1, sales: "5", seconds: 60 }], refunds: [], info: [], days: 1 });
    assert.deepEqual([lines[0].name, lines[0].deleted], ["Deleted table", true]);
  });

  test("the heat map: each table against the busiest", () => {
    const { lines } = report();
    const net = heatOf(lines, "net");
    assert.deepEqual([net.get("t1")?.share, Math.round(net.get("p1")!.share * 100)], [1, 14]);
    assert.deepEqual([heatOf(lines, "turns").get("t2")?.share], [0.5]);
    assert.equal(heatOf([], "net").size, 0);
  });
});

describe("By order type", () => {
  test("all four types always; % of sales; average prep time", () => {
    const { lines, totals } = typeLines({
      orders: [
        { type: "DINE_IN", orders: 3, sales: "300.00" },
        { type: "BAR_TAB", orders: 2, sales: "100.00" },
      ],
      refunds: [{ type: "DINE_IN", amount: "20.00" }],
      prep: [
        { type: "DINE_IN", seconds: 600, lines: 4 },
        { type: "BAR_TAB", seconds: 120, lines: 2 },
      ],
    });
    assert.deepEqual(lines.map((l) => [l.type, l.orders, l.net, l.averageBill, l.share, l.prepSeconds]), [
      ["DINE_IN", 3, "280.00", "100.00", 73.7, 600],
      ["TAKEAWAY", 0, "0.00", null, 0, null],
      ["BAR_TAB", 2, "100.00", "50.00", 26.3, 120],
      ["DELIVERY", 0, "0.00", null, 0, null],
    ]);
    assert.deepEqual([totals.orders, totals.net, totals.averageBill, totals.share, totals.prepSeconds], [5, "380.00", "80.00", 100, 440], "(600×4 + 120×2) / 6");
  });
});
