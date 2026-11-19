// Run with: npx tsx --test modules/restaurant/__tests__/tabletOrder.test.ts
// Part 6g Step 5: the tablet's Order screen rules (lib/tabletOrder.ts) — the
// menu's groups and tiles, the check's tags and counts, the order's words,
// the options' steps and the running price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crumb, groupTiles, lineTag, naira, orderCounts, orderMeta, orderTitle, priceOf, sentTo, tabletSteps, topGroups } from "../lib/tabletOrder";

const g = (id: string, name: string, parentId: string | null, colour = "#C2410C") => ({ id, name, parentId, department: "FOOD" as const, colour, auto: false });
const tree = {
  groups: { rice: g("rice", "Rice", null), combo: g("combo", "Rice Combos", "rice"), soups: g("soups", "Soups", null, "#B45309") },
  row: { FOOD: ["rice", "soups"], BAR: [] },
  home: { FOOD: [], BAR: [] },
  grids: {
    rice: [{ kind: "item" as const, id: "jollof" }, null, { kind: "group" as const, id: "combo" }, { kind: "item" as const, id: "gone" }, { kind: "item" as const, id: "fried" }],
    combo: [{ kind: "item" as const, id: "platter" }, { kind: "item" as const, id: "tray" }, null],
    soups: [],
  },
  dishGroup: {},
  dishDepartment: {},
};
const items = [
  { id: "jollof", name: "Jollof Rice", price: "₦3,500.00", requiredOptions: true, unavailable: null },
  { id: "fried", name: "Fried Rice", price: "₦3,800.00", requiredOptions: false, unavailable: "out" as const },
  { id: "platter", name: "Party Platter", price: "₦18,000.00", requiredOptions: false, unavailable: null },
  { id: "tray", name: "Family Tray", price: "₦24,000.00", requiredOptions: false, unavailable: null },
];

test("the groups row: the department's top groups, in order", () => {
  assert.deepEqual(topGroups(tree, "FOOD").map((x) => x.name), ["Rice", "Soups"]);
  assert.deepEqual(topGroups(tree, "BAR"), []);
});

test("a group's tiles: dishes (• when options are required, sold out greyed) and sub-groups with their count; empty cells and unknown dishes left out", () => {
  assert.deepEqual(groupTiles(tree, items, "rice"), [
    { kind: "item", id: "jollof", name: "Jollof Rice", price: "₦3,500.00", colour: "#C2410C", required: true, soldOut: false },
    { kind: "group", id: "combo", name: "Rice Combos", colour: "#C2410C", count: 2 },
    { kind: "item", id: "fried", name: "Fried Rice", price: "₦3,800.00", colour: "#C2410C", required: false, soldOut: true },
  ]);
  assert.deepEqual(groupTiles(tree, items, "combo").map((t) => [t.name, t.colour]), [["Party Platter", "#C2410C"], ["Family Tray", "#C2410C"]], "a sub-group's dishes in the top group's colour");
  assert.equal(crumb(tree, "combo"), "Rice › Rice Combos");
});

test("the check: NEW until sent, SENT, VOID once cancelled; the ORDER bar's counts", () => {
  assert.equal(lineTag({ cancelled: false, sentAt: null }), "NEW");
  assert.equal(lineTag({ cancelled: false, sentAt: "19:40" }), "SENT");
  assert.equal(lineTag({ cancelled: true, sentAt: "19:40" }), "VOID");
  const lines = [
    { quantity: 2, cancelled: false, sentAt: "19:40" },
    { quantity: 3, cancelled: false, sentAt: null },
    { quantity: 1, cancelled: true, sentAt: "19:41" },
  ];
  assert.deepEqual(orderCounts(lines), { items: 5, notSent: 3 });
  assert.deepEqual(orderCounts(lines, 1), { items: 6, notSent: 4 }, "a tap still saving counts");
  assert.deepEqual(orderCounts([]), { items: 0, notSent: 0 });
});

test("the header: Table 5, a named table, a takeaway, a tab; guests and the waiter", () => {
  assert.equal(orderTitle({ type: "DINE_IN", tableName: "5", tabName: null, ref: "ORD-0001" }), "Table 5");
  assert.equal(orderTitle({ type: "DINE_IN", tableName: "V1", tabName: null, ref: "ORD-0001" }), "V1");
  assert.equal(orderTitle({ type: "TAKEAWAY", tableName: null, tabName: null, ref: "ORD-0002" }), "Takeaway · ORD-0002");
  assert.equal(orderTitle({ type: "BAR_TAB", tableName: null, tabName: "Ada", ref: "ORD-0003" }), "Tab · Ada");
  assert.equal(orderMeta(4, "Ada O."), "4 guests · Ada O.");
  assert.equal(orderMeta(1, null), "1 guest");
  assert.equal(orderMeta(0, "Ada O."), "Ada O.");
});

test("the options' steps: required groups first, in the dish's order, then each optional one", () => {
  const groups = [
    { id: "x", name: "Extras", minSelect: 0, maxSelect: 3, options: [] },
    { id: "p", name: "Portion", minSelect: 1, maxSelect: 1, options: [] },
    { id: "s", name: "Spice", minSelect: 1, maxSelect: 1, options: [] },
    { id: "m", name: "Mixer", minSelect: 0, maxSelect: 1, options: [] },
  ];
  assert.deepEqual(tabletSteps(groups).map((s) => s.name), ["Portion", "Spice", "Extras", "Mixer"]);
});

test("the running price: shown prices read back, written short", () => {
  assert.equal(priceOf("₦3,500.00"), 3500);
  assert.equal(priceOf("+₦1,000.00"), 1000);
  assert.equal(priceOf("−₦500.00"), -500);
  assert.equal(priceOf(""), 0);
  assert.equal(naira(3500 + 1000 + 700), "₦5,200");
  assert.equal(naira(1250.5), "₦1,250.50");
});

test("what SEND says", () => {
  assert.equal(sentTo([{ station: "Kitchen", count: 2 }, { station: "Bar", count: 3 }]), "Sent to Kitchen + Bar");
  assert.equal(sentTo([{ station: "Kitchen", count: 2 }, { station: "Bar", count: 0 }]), "Sent to Kitchen");
  assert.equal(sentTo([]), null);
});
