// Restaurant Reports, Step 3: By dish put together, sorted, grouped and
// classed (menu engineering).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classify, dishLines, groupDishes, quadrants, sortDishes, type DishInfo } from "../lib/reportDishes";

const INFO: DishInfo[] = [
  { productId: "jollof", name: "Jollof", department: "FOOD", group: "Mains" },
  { productId: "suya", name: "Suya", department: "FOOD", group: "Grill" },
  { productId: "zobo", name: "Zobo", department: "BAR", group: "Drinks" },
  { productId: "soup", name: "Pepper soup", department: "FOOD", group: "Mains" },
];

const report = (withCost = true) =>
  dishLines({
    sales: [
      { productId: "jollof", quantity: 10, gross: "200.00", discount: "10.004" },
      { productId: "suya", quantity: 2, gross: "60.00", discount: "0" },
      { productId: "zobo", quantity: 8, gross: "80.00", discount: "4" },
      { productId: "soup", quantity: 1, gross: "15.00", discount: "0" },
    ],
    refunds: [
      { productId: "zobo", quantity: 1, amount: "9.50" },
      // Sold in an earlier period, refunded in this one.
      { productId: "gone", quantity: 1, amount: "5.00" },
    ],
    costs: withCost
      ? [
          { productId: "jollof", cost: "90.00", quantity: 10, missingQuantity: 0 },
          { productId: "suya", cost: "12.00", quantity: 2, missingQuantity: 0 },
          { productId: "zobo", cost: "16.00", quantity: 8, missingQuantity: 0 },
          { productId: "soup", cost: "0", quantity: 1, missingQuantity: 1 },
        ]
      : null,
    info: INFO,
    modifiers: [
      { productId: "jollof", group: "Protein", name: "Extra chicken", times: 4, revenue: "8.00" },
      { productId: "jollof", group: "Sides", name: "No pepper", times: 6, revenue: "0" },
    ],
    minutes86: new Map([["suya", 95]]),
  });

describe("By dish", () => {
  test("net = gross − its discount share − refunds made in the period", () => {
    const { lines } = report();
    const by = Object.fromEntries(lines.map((l) => [l.productId, l]));
    assert.deepEqual([by.jollof.gross, by.jollof.discount, by.jollof.net], ["200.00", "10.00", "190.00"]);
    assert.deepEqual([by.zobo.refunds, by.zobo.net], ["9.50", "66.50"]);
    assert.deepEqual([by.gone.name, by.gone.quantity, by.gone.net], ["Deleted item", 0, "-5.00"], "a refund alone still shows");
  });

  test("food cost, margin and margin %; no cost at all is unknown, not ₦0", () => {
    const by = Object.fromEntries(report().lines.map((l) => [l.productId, l]));
    assert.deepEqual([by.jollof.cost, by.jollof.margin, by.jollof.marginPct], ["90.00", "100.00", 52.6]);
    assert.deepEqual([by.soup.cost, by.soup.margin, by.soup.costMissing], [null, null, 1]);
  });

  test("without View Cost: no cost, margin or class anywhere", () => {
    const { lines, totals } = report(false);
    assert.ok(lines.every((l) => l.cost === null && l.margin === null && l.marginPct === null && l.menuClass === null));
    assert.deepEqual([totals.cost, totals.margin], [null, null]);
  });

  test("% of sales: each dish's share of all the dishes' net; totals add up", () => {
    const { lines, totals } = report();
    assert.equal(totals.net, "326.50");
    assert.equal(lines.find((l) => l.productId === "jollof")?.share, 58.2);
    assert.equal(lines.reduce((t, l) => t + Number(l.net), 0).toFixed(2), totals.net);
  });

  test("modifiers: most chosen first; 86'd minutes from the log", () => {
    const by = Object.fromEntries(report().lines.map((l) => [l.productId, l]));
    assert.deepEqual(by.jollof.modifiers.map((m) => [m.name, m.times, m.revenue]), [["No pepper", 6, "0.00"], ["Extra chicken", 4, "8.00"]]);
    assert.deepEqual([by.suya.minutes86, by.jollof.minutes86], [95, 0]);
  });
});

describe("menu engineering", () => {
  // Average plates: (10 + 2 + 8) / 3 = 6.67; average margin a plate: (100 + 48 + 50.5) / 20 = 9.925.
  test("each dish against the average plates and the average margin a plate", () => {
    const by = Object.fromEntries(report().lines.map((l) => [l.productId, l.menuClass]));
    assert.deepEqual(by, { jollof: "STAR", suya: "PUZZLE", zobo: "PLOWHORSE", soup: null, gone: null });
  });

  test("the four quadrants", () => {
    const q = quadrants(report().lines);
    assert.deepEqual(q.STAR, { dishes: 1, net: "190.00" });
    assert.deepEqual(q.PUZZLE, { dishes: 1, net: "60.00" });
    assert.deepEqual(q.PLOWHORSE, { dishes: 1, net: "66.50" });
    assert.deepEqual(q.DOG, { dishes: 0, net: "0.00" });
  });

  test("a dog: below both averages", () => {
    const c = classify([
      { productId: "a", quantity: 10, margin: "100", costMissing: 0 },
      { productId: "b", quantity: 2, margin: "4", costMissing: 0 },
    ]);
    assert.deepEqual([c.get("a"), c.get("b")], ["STAR", "DOG"]);
  });
});

describe("sorting and grouping", () => {
  test("any column, either way; unknown values last", () => {
    const { lines } = report();
    assert.deepEqual(sortDishes(lines, "net", "desc").map((l) => l.productId), ["jollof", "zobo", "suya", "soup", "gone"]);
    assert.deepEqual(sortDishes(lines, "name", "asc").map((l) => l.name), ["Deleted item", "Jollof", "Pepper soup", "Suya", "Zobo"]);
    // Margin: zobo 50.50, suya 48.00, jollof 100.00; soup has no cost; "gone" was only refunded (−5.00, no cost line).
    assert.deepEqual(sortDishes(lines, "margin", "asc").map((l) => l.productId), ["gone", "suya", "zobo", "jollof", "soup"]);
    assert.deepEqual(sortDishes(lines, "margin", "desc").map((l) => l.productId), ["jollof", "zobo", "suya", "gone", "soup"], "no cost: last either way");
  });

  test("department, then group, with subtotals", () => {
    const groups = groupDishes(sortDishes(report().lines, "net", "desc"), true);
    assert.deepEqual(groups.map((d) => [d.department, d.groups.map((g) => g.group), d.totals.net]), [
      ["FOOD", ["Grill", "Mains"], "265.00"],
      ["BAR", ["Drinks"], "66.50"],
      ["NONE", [null], "-5.00"],
    ]);
    const mains = groups[0].groups.find((g) => g.group === "Mains")!;
    assert.deepEqual([mains.lines.map((l) => l.productId), mains.totals.net, mains.totals.cost], [["jollof", "soup"], "205.00", "90.00"]);
  });
});
