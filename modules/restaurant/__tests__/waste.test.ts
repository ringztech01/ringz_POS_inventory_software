// Run with: npx tsx --test modules/restaurant/__tests__/waste.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOD_PERMISSIONS, visibleFoodTabs } from "../lib/foodTabs";
import { planWaste, readWasteFilter, summarizeWaste, type WasteItem, type WastePlan } from "../lib/waste";
import { isBilled } from "../lib/bill";
import { foodCostOf, WASTE_LABEL, wasteLevel, wasteShare, wasteShareNote } from "../lib/dashboard";
import { cancelReasonsFor } from "../lib/cancelReasons";
import { cancelLineSchema, cancelOrderSchema } from "../schemas/orderFlow";
import { logWasteSchema, previewWasteSchema, remakeSchema, voidWasteSchema } from "../schemas/waste";

// Jollof: 250 g rice (₦0.02/g) + 1 chicken (₦3.50) per serving.
const jollof: WasteItem = {
  id: "jollof",
  name: "Jollof",
  productType: "MENU_ITEM",
  cost: "9.99",
  recipe: [
    { ingredientId: "rice", ingredientName: "Rice", quantity: "250", cost: "0.02" },
    { ingredientId: "chicken", ingredientName: "Chicken", quantity: "1", cost: "3.50" },
  ],
};
const show = (p: WastePlan) => (p.ok ? { lines: p.lines.map((l) => [l.productId, l.qty.toString(), l.unitCost.toFixed(2), l.lineCost.toFixed(2)]), total: p.total.toFixed(2) } : p.error);

test("a recipe item: its ingredients (resolveStockLines), each at its cost now — not the dish's own cost", () => {
  assert.deepEqual(show(planWaste(jollof, "2")), {
    lines: [
      ["chicken", "2", "3.50", "7.00"],
      ["rice", "500", "0.02", "10.00"],
    ],
    total: "17.00",
  });
  // Half a serving: 125 g and… half a chicken — refused (stock is whole units).
  assert.match(show(planWaste(jollof, "0.5")) as string, /^Chicken: that comes to part of a unit \(0\.5\)/);
  // A recipe that comes out whole for half a serving.
  const rice = { ...jollof, recipe: [jollof.recipe[0]] };
  assert.deepEqual(show(planWaste(rice, "0.5")), { lines: [["rice", "125", "0.02", "2.50"]], total: "2.50" });
});

test("a menu item without a recipe, or a raw ingredient: itself, at its own cost", () => {
  assert.deepEqual(show(planWaste({ ...jollof, recipe: [] }, "3")), { lines: [["jollof", "3", "9.99", "29.97"]], total: "29.97" });
  assert.deepEqual(show(planWaste({ id: "fanta", name: "Fanta", productType: "INGREDIENT", cost: "0.60", recipe: [] }, "2")), { lines: [["fanta", "2", "0.60", "1.20"]], total: "1.20" });
  // No cost set: ₦0.
  assert.deepEqual(show(planWaste({ id: "x", name: "X", productType: "INGREDIENT", cost: null, recipe: [] }, "1")), { lines: [["x", "1", "0.00", "0.00"]], total: "0.00" });
  // An ingredient's own recipe lines are ignored (only menu items expand).
  assert.deepEqual(show(planWaste({ ...jollof, id: "ing", productType: "INGREDIENT", cost: "1", recipe: jollof.recipe }, "1")), { lines: [["ing", "1", "1.00", "1.00"]], total: "1.00" });
  assert.equal(show(planWaste({ ...jollof, recipe: [] }, "1.5")), "Jollof is counted in whole units — waste a whole number of them.");
});

test("refused: a retail product, nothing to waste", () => {
  assert.equal(show(planWaste({ ...jollof, productType: "STANDARD" }, "1")), "Only menu items and ingredients are logged as waste.");
  assert.equal(show(planWaste(jollof, "0")), "The quantity must be more than 0.");
});

test("the log schema: a note for Other, a positive quantity, a known reason; never a cost", () => {
  const base = { productId: "p1", qty: "2", unit: "pc", reason: "BURNT" };
  assert.ok(logWasteSchema.safeParse(base).success);
  const issue = (input: object) => logWasteSchema.safeParse({ ...base, ...input }).error?.issues[0]?.message;
  assert.equal(issue({ reason: "OTHER" }), "Say what happened (needed for Other).");
  assert.ok(logWasteSchema.safeParse({ ...base, reason: "OTHER", note: "Freezer failed" }).success);
  assert.equal(issue({ note: "x".repeat(301) }), "The note can be at most 300 characters.");
  assert.equal(issue({ qty: "0" }), "The quantity must be more than 0.");
  assert.equal(issue({ qty: "-1" }), "Enter a quantity like 2 or 0.5.");
  assert.equal(issue({ qty: "1.2345" }), "Enter a quantity like 2 or 0.5.");
  assert.equal(issue({ reason: "STOLEN" }), "Choose a reason.");
  assert.equal(issue({ approval: { approverId: "u1", pin: "12" } }), "The PIN is 4 to 6 digits.");
  const parsed = logWasteSchema.parse({ ...base, costSnapshot: "0.01", lines: [] });
  assert.deepEqual(Object.keys(parsed).sort(), ["note", "productId", "qty", "reason", "unit"]);
});

test("the void schema: a reason and the version", () => {
  assert.ok(voidWasteSchema.safeParse({ id: "w1", reason: "Wrong item", version: 0 }).success);
  assert.equal(voidWasteSchema.safeParse({ id: "w1", reason: " ", version: 0 }).error?.issues[0]?.message, "Give a reason for the void.");
  assert.equal(voidWasteSchema.safeParse({ id: "w1", reason: "x", version: -1 }).success, false);
});

// ---- Food › Waste (Step 3)

test("the list's filters from the URL: today by default, known values only", () => {
  const now = new Date("2026-11-05T09:00:00.000Z");
  const read = (params: Parameters<typeof readWasteFilter>[0]) => readWasteFilter(params, ["u1", "u2"], now);
  assert.deepEqual(read({}), { range: { from: "2026-11-05", to: "2026-11-05" }, reason: null, userId: null, status: null, q: "" });
  // Lagos is UTC+1: 23:30 UTC on the 5th is already the 6th.
  assert.deepEqual(readWasteFilter({}, [], new Date("2026-11-05T23:30:00.000Z")).range, { from: "2026-11-06", to: "2026-11-06" });
  assert.deepEqual(read({ from: "2026-11-03", to: "2026-11-01" }).range, { from: "2026-11-01", to: "2026-11-03" });
  assert.deepEqual(read({ from: "2026-11-02" }).range, { from: "2026-11-02", to: "2026-11-02" });
  assert.deepEqual(read({ from: "2026-02-30", to: "nope" }).range, { from: "2026-11-05", to: "2026-11-05" });
  assert.deepEqual(read({ from: "2020-01-01", to: "2026-11-05" }).range, { from: "2025-11-04", to: "2026-11-05" });
  assert.deepEqual(
    read({ reason: "BURNT", user: "u2", status: "VOID", q: "  rice  " }),
    { range: { from: "2026-11-05", to: "2026-11-05" }, reason: "BURNT", userId: "u2", status: "VOID", q: "rice" },
  );
  const unknown = read({ reason: "STOLEN", user: "someone", status: "DELETED" });
  assert.deepEqual([unknown.reason, unknown.userId, unknown.status], [null, null, null]);
});

test("the summary strip: total, entries, the reason that cost the most", () => {
  const s = summarizeWaste([
    { reason: "EXPIRED", cost: "1.20", count: 2 },
    { reason: "BURNT", cost: "17.00", count: 1 },
    { reason: "OTHER", cost: "0.00", count: 1 },
  ]);
  assert.deepEqual([s.total.toFixed(2), s.count, s.topReason], ["18.20", 4, "BURNT"]);
  // Same cost: more entries wins, then the reasons' order.
  assert.equal(summarizeWaste([{ reason: "DROPPED", cost: "5", count: 1 }, { reason: "OTHER", cost: "5", count: 3 }]).topReason, "OTHER");
  assert.equal(summarizeWaste([{ reason: "OTHER", cost: "5", count: 1 }, { reason: "BURNT", cost: "5", count: 1 }]).topReason, "BURNT");
  const none = summarizeWaste([]);
  assert.deepEqual([none.total.toFixed(2), none.count, none.topReason], ["0.00", 0, null]);
});

test("the Food tabs follow the permissions; Waste for Log or Approve Waste", () => {
  const keys = (permissions: string[]) => visibleFoodTabs(new Set(permissions)).map((t) => t.key);
  assert.deepEqual(keys(["Manage Food"]), ["items", "modifiers", "recipes"]);
  assert.deepEqual(keys(["Log Waste"]), ["waste"]);
  assert.deepEqual(keys(["Approve Waste"]), ["waste"]);
  assert.deepEqual(keys(["Manage Food", "Log Waste"]), ["items", "modifiers", "recipes", "waste"]);
  assert.deepEqual(keys(["Manage Orders"]), []);
  assert.deepEqual([...FOOD_PERMISSIONS], ["Manage Food", "Log Waste", "Approve Waste"]);
});

test("the live preview's input: an item and a quantity", () => {
  assert.ok(previewWasteSchema.safeParse({ productId: "p1", qty: "2" }).success);
  assert.equal(previewWasteSchema.safeParse({ productId: "p1", qty: "0" }).error?.issues[0]?.message, "The quantity must be more than 0.");
  assert.equal(previewWasteSchema.safeParse({ productId: "p1", qty: "two" }).error?.issues[0]?.message, "Enter a quantity like 2 or 0.5.");
});

// ---- Step 4: Remake and Returned by guest

test("a remake line is never billed (made at no charge)", () => {
  const base = { kitchenStatus: "READY" as const, cancelledAt: null, deletedAt: null };
  assert.equal(isBilled({ ...base, remakeOfId: null }), true);
  assert.equal(isBilled({ ...base, remakeOfId: "line-1" }), false);
});

test("Returned by guest: offered for a served line only, never for a whole order", () => {
  assert.ok(cancelReasonsFor({ served: true }).includes("RETURNED_BY_GUEST"));
  assert.ok(!cancelReasonsFor({ served: false }).includes("RETURNED_BY_GUEST"));
  assert.ok(!cancelReasonsFor("order").includes("RETURNED_BY_GUEST"));
  assert.equal(cancelReasonsFor("order").at(-1), "OTHER");
  const line = { orderId: "o1", version: 1, lineId: "l1", details: "" };
  assert.equal(cancelLineSchema.safeParse({ ...line, reason: "RETURNED_BY_GUEST", wasted: true }).success, true);
  assert.equal(cancelLineSchema.safeParse({ ...line, reason: "WRONG_ITEM", wasted: true }).error?.issues[0]?.message, "Only food returned by the guest is logged as waste here.");
  assert.equal(cancelLineSchema.parse({ ...line, reason: "WRONG_ITEM" }).wasted, false);
  assert.equal(cancelOrderSchema.safeParse({ orderId: "o1", version: 1, reason: "RETURNED_BY_GUEST", details: "" }).error?.issues[0]?.message, "Returned by guest is for a served line, not a whole order.");
});

test("the remake schema: whole dishes, Burnt or Dropped", () => {
  const base = { itemId: "l1", qty: 1, reason: "BURNT" };
  assert.ok(remakeSchema.safeParse(base).success);
  const issue = (input: object) => remakeSchema.safeParse({ ...base, ...input }).error?.issues[0]?.message;
  assert.equal(issue({ qty: 1.5 }), "Remake whole dishes.");
  assert.equal(issue({ qty: 0 }), "Remake at least 1.");
  assert.equal(issue({ reason: "EXPIRED" }), "Choose Burnt or Dropped.");
});

// ---- Step 5: the dashboard's Waste tile

test("food cost: the billed lines' stock per unit × quantity, at each product's cost", () => {
  const costs = new Map<string, string>([["rice", "0.02"], ["chicken", "3.50"], ["fanta", "0.60"]]);
  const lines = [
    { quantity: 2, stockPerUnit: [{ productId: "rice", productName: "Rice", quantity: 250 }, { productId: "chicken", productName: "Chicken", quantity: 1 }] },
    { quantity: 3, stockPerUnit: [{ productId: "fanta", productName: "Fanta", quantity: 1 }] },
    // No cost set: ₦0. Not recorded (settled before stockPerUnit): nothing.
    { quantity: 1, stockPerUnit: [{ productId: "salt", productName: "Salt", quantity: 5 }] },
    { quantity: 4, stockPerUnit: null },
  ];
  assert.equal(foodCostOf(lines, costs).toFixed(2), "18.80");
  assert.equal(foodCostOf([], costs).toFixed(2), "0.00");
});

test("waste share and colour: amber above the amber %, red above the red %", () => {
  assert.equal(wasteShare("5", "100"), 5);
  assert.equal(wasteShare("1", "3"), 33.3);
  assert.equal(wasteShare("5", "0"), null);
  assert.equal(wasteLevel(5, "5", "5", "10"), "ok", "5% is not above 5%");
  assert.equal(wasteLevel(5.1, "5.1", "5", "10"), "amber");
  assert.equal(wasteLevel(10, "10", "5", "10"), "amber");
  assert.equal(wasteLevel(10.1, "10.1", "5", "10"), "red");
  assert.equal(wasteLevel(12, "12", "8", "15"), "amber", "the settings decide");
  assert.equal(wasteLevel(null, "0", "5", "10"), "ok");
  assert.equal(wasteLevel(null, "3", "5", "10"), "amber", "waste with nothing billed");
  assert.equal(wasteShareNote(3.2, "1200", 2), "3.2% of food cost (₦1,200.00)");
  assert.equal(wasteShareNote(null, "0", 0), "Nothing wasted");
  assert.equal(wasteShareNote(null, "0", 1), "No food cost billed yet");
  assert.deepEqual(WASTE_LABEL, { today: "Waste today", yesterday: "Waste yesterday", "7d": "Waste · 7 days" });
});
