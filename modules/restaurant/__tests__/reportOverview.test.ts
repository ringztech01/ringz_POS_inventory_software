// Restaurant Reports, Step 2: the cost recorded at settle and the Overview
// put together from grouped rows.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unitCostOf } from "../lib/lineCost";
import { bestDayOf, foodCostPercent, netByDay, netByDepartment, netByHour, netByType, perCover, pointsNote, previousName, totalsOf, type RefundRow, type SalesRow } from "../lib/reportOverview";

describe("a sold line's cost at settle", () => {
  const costs = new Map<string, string | null>([
    ["jollof", "999"],
    ["rice", "2.50"],
    ["chicken", "4.00"],
    ["coke", "1.20"],
    ["salt", null],
    ["water", "0"],
  ]);
  const dish = (recipe: { ingredientId: string; quantity: string }[]) => ({ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM" as const, recipe: recipe.map((r) => ({ ...r, ingredientName: r.ingredientId })) });

  test("with a recipe: its ingredients × their costs (the dish's own cost isn't used)", () => {
    assert.equal(unitCostOf(dish([{ ingredientId: "rice", quantity: "2" }, { ingredientId: "chicken", quantity: "1" }]), costs)?.toFixed(4), "9.0000");
  });

  test("no recipe: the item's own cost", () => {
    assert.equal(unitCostOf({ productId: "coke", productName: "Coke", productType: "STANDARD", recipe: [] }, costs)?.toFixed(4), "1.2000");
    assert.equal(unitCostOf(dish([]), costs)?.toFixed(4), "999.0000", "a menu item with no recipe");
  });

  test("an ingredient with no cost: no cost for the line (counted in the note); a cost of 0 is a cost", () => {
    assert.equal(unitCostOf(dish([{ ingredientId: "rice", quantity: "1" }, { ingredientId: "salt", quantity: "1" }]), costs), null);
    assert.equal(unitCostOf(dish([{ ingredientId: "rice", quantity: "1" }, { ingredientId: "nowhere", quantity: "1" }]), costs), null, "unknown product");
    assert.equal(unitCostOf(dish([{ ingredientId: "water", quantity: "3" }]), costs)?.toFixed(4), "0.0000");
  });

  test("fractions of a unit are kept to 4 places", () => {
    assert.equal(unitCostOf(dish([{ ingredientId: "rice", quantity: "0.333" }]), costs)?.toFixed(4), "0.8325");
  });
});

// Two days, 4 Nov and 5 Nov; refunds on the 5th (one of a bill from the 4th).
const SALES: SalesRow[] = [
  { day: "2026-11-04", hour: 13, type: "DINE_IN", orders: 2, covers: 5, sales: "100.00" },
  { day: "2026-11-04", hour: 19, type: "TAKEAWAY", orders: 1, covers: 1, sales: "30.00" },
  { day: "2026-11-05", hour: 19, type: "DINE_IN", orders: 3, covers: 6, sales: "150.50" },
];
const REFUNDS: RefundRow[] = [{ day: "2026-11-05", hour: 10, type: "DINE_IN", refunds: "20.50" }];
const RANGE = { from: "2026-11-04", to: "2026-11-06" };

describe("the Overview's figures", () => {
  const t = totalsOf({ sales: SALES, refunds: REFUNDS, tips: "12.00", waste: "8.40", wasteEntries: 2, cost: { cost: "84.00", quantity: 20, missingQuantity: 1 } });

  test("net sales = bills − refunds in the period; tips are never in it", () => {
    assert.equal(t.sales.toFixed(2), "280.50");
    assert.equal(t.refunds.toFixed(2), "20.50");
    assert.equal(t.net.toFixed(2), "260.00");
    assert.equal(t.tips.toFixed(2), "12.00");
    assert.deepEqual([t.orders, t.covers], [6, 12]);
  });

  test("by hour, by day and by order type all add up to net sales", () => {
    const add = (rows: { total?: string; net?: string }[]) => rows.reduce((n, r) => n + Number(r.total ?? r.net), 0).toFixed(2);
    assert.equal(add(netByHour(SALES, REFUNDS)), "260.00");
    assert.equal(add(netByDay(RANGE, SALES, REFUNDS)), "260.00");
    assert.equal(add(netByType(SALES, REFUNDS)), "260.00");
  });

  test("a refund lowers the day it happened on, not the bill's day", () => {
    assert.deepEqual(netByDay(RANGE, SALES, REFUNDS), [
      { day: "2026-11-04", total: "130.00" },
      { day: "2026-11-05", total: "130.00" },
      { day: "2026-11-06", total: "0.00" },
    ]);
    assert.deepEqual(netByHour(SALES, REFUNDS), [
      { hour: 10, total: "-20.50" },
      { hour: 13, total: "100.00" },
      { hour: 19, total: "180.50" },
    ]);
  });

  test("order types: orders and net; a type with nothing is left out", () => {
    assert.deepEqual(netByType(SALES, REFUNDS), [
      { type: "DINE_IN", orders: 5, net: "230.00" },
      { type: "TAKEAWAY", orders: 1, net: "30.00" },
    ]);
  });

  test("best day: the most net sales, the earliest on a tie; none when nothing sold", () => {
    assert.deepEqual(bestDayOf(netByDay(RANGE, SALES, REFUNDS)), { day: "2026-11-04", total: "130.00" });
    assert.equal(bestDayOf([{ day: "2026-11-04", total: "0.00" }]), null);
  });

  test("food cost % = cost ÷ net sales", () => {
    assert.equal(foodCostPercent("84.00", t.net), 32.3);
    assert.equal(foodCostPercent("10", "0"), null, "no net sales");
    assert.equal(pointsNote(32.3, 30, "previous 7 days"), "+2.3 pts vs the previous 7 days");
    assert.equal(pointsNote(30, 32.3, "previous day"), "−2.3 pts vs the previous day");
    assert.equal(pointsNote(30, null, "previous day"), "Nothing to compare with in the previous day");
  });

  test("per cover; what the notes compare with", () => {
    assert.equal(perCover("280.50", 12), "23.38");
    assert.equal(perCover("10", 0), "0.00");
    assert.equal(previousName(1), "previous day");
    assert.equal(previousName(7), "previous 7 days");
  });

  test("Food vs Bar: item sales less items returned; empty departments left out", () => {
    assert.deepEqual(
      netByDepartment(
        [
          { department: "FOOD", amount: "200.00" },
          { department: "BAR", amount: "60.00" },
        ],
        [{ department: "BAR", amount: "10.00" }],
      ),
      [
        { department: "FOOD", net: "200.00" },
        { department: "BAR", net: "50.00" },
      ],
    );
  });
});
