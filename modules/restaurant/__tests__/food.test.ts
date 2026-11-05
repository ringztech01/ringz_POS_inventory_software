// Run with: npx tsx --test modules/restaurant/__tests__/food.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { foodCost, marginPercent, recipeLineCost, trimQuantity } from "../lib/foodCost";
import { menuItemFlagSchema, menuItemSchema } from "../schemas/menuItem";
import { modifierGroupSchema } from "../schemas/modifierGroup";
import { groupType, isRequiredGroup, priceChangeLabel } from "../lib/modifiers";
import { modifierSchema, moveModifierSchema } from "../schemas/modifier";
import { recipeLineSchema } from "../schemas/recipe";
import { AVAILABILITY_TAG, menuAvailability } from "../lib/menuAvailability";

test("recipe line cost = quantity × the ingredient's unit cost (no cost = 0); food cost = their sum", () => {
  assert.equal(recipeLineCost("0.25", "2.20").toString(), "0.55");
  assert.equal(recipeLineCost("0.3", "6.00").toString(), "1.8");
  assert.equal(recipeLineCost("1", null).toString(), "0");
  const lines = [
    { quantity: "0.25", unitCost: "2.20" },
    { quantity: "0.3", unitCost: "6.00" },
    { quantity: "0.1", unitCost: "4.00" },
    { quantity: "1", unitCost: "0.30" },
  ];
  assert.equal(foodCost(lines).toFixed(2), "3.05");
  assert.equal(foodCost([]).toString(), "0");
});

test("margin = (price − food cost) / price × 100, whole percent; none without a price", () => {
  assert.equal(marginPercent("18.00", "3.05"), 83);
  assert.equal(marginPercent("6", "0.95"), 84);
  assert.equal(marginPercent("10", "12"), -20);
  assert.equal(marginPercent("0", "1"), null);
});

test("recipe quantities without trailing zeros", () => {
  assert.equal(trimQuantity("0.250"), "0.25");
  assert.equal(trimQuantity("1.000"), "1");
});

const valid = { code: "MN-001", name: "Jollof Rice & Chicken", categoryId: "cat1", price: "18.50", description: "", stationId: "" };

test("menu item form: required fields, price format, code characters, description length; blanks become null", () => {
  const parsed = menuItemSchema.parse({ ...valid, name: "  Jollof  " });
  assert.deepEqual([parsed.name, parsed.description, parsed.stationId], ["Jollof", null, null]);
  assert.equal(menuItemSchema.parse({ ...valid, stationId: "st1", description: " Smoky " }).description, "Smoky");
  const errors = (input: object) => {
    const result = menuItemSchema.safeParse(input);
    return result.success ? null : Object.keys(result.error.flatten().fieldErrors).sort();
  };
  assert.deepEqual(errors({ ...valid, code: "", name: "", categoryId: "", price: "" }), ["categoryId", "code", "name", "price"]);
  for (const price of ["0", "0.00", "-5", "18.555", "abc", "1,000"]) assert.deepEqual(errors({ ...valid, price }), ["price"], price);
  for (const price of ["18", "18.5", "0.01", "1250.00"]) assert.equal(errors({ ...valid, price }), null, price);
  assert.deepEqual(errors({ ...valid, code: "MN 001" }), ["code"]);
  assert.deepEqual(errors({ ...valid, description: "x".repeat(501) }), ["description"]);
  assert.equal(errors({ ...valid, description: "x".repeat(500) }), null);
});

test("the list's switches: Available or On menu, true/false only", () => {
  assert.equal(menuItemFlagSchema.safeParse({ id: "p1", field: "isAvailable", value: false }).success, true);
  assert.equal(menuItemFlagSchema.safeParse({ id: "p1", field: "price", value: true }).success, false);
  assert.equal(menuItemFlagSchema.safeParse({ id: "p1", field: "showOnMenu", value: "yes" }).success, false);
});

test("modifier group form: 0–10, the minimum never above the maximum, Required agrees with the minimum", () => {
  const ok = (input: object) => modifierGroupSchema.safeParse(input).success;
  const firstError = (input: object) => {
    const r = modifierGroupSchema.safeParse(input);
    return r.success ? null : r.error.issues[0].message;
  };
  assert.deepEqual(modifierGroupSchema.parse({ name: " Portion ", minSelect: "1", maxSelect: "1", required: true }), { name: "Portion", minSelect: 1, maxSelect: 1, required: true });
  assert.equal(ok({ name: "Extras", minSelect: 0, maxSelect: 2, required: false }), true);
  assert.equal(firstError({ name: "X", minSelect: 3, maxSelect: 2, required: true }), "The minimum can't be more than the maximum.");
  assert.equal(firstError({ name: "X", minSelect: 0, maxSelect: 2, required: true }), "A required group needs a minimum of at least 1.");
  assert.equal(firstError({ name: "X", minSelect: 1, maxSelect: 2, required: false }), "An optional group has a minimum of 0 — or switch on Required.");
  assert.equal(ok({ name: "X", minSelect: 0, maxSelect: 0, required: false }), false, "max at least 1");
  assert.equal(ok({ name: "X", minSelect: 0, maxSelect: 11, required: false }), false, "max at most 10");
  assert.equal(ok({ name: "X", minSelect: 1.5, maxSelect: 2, required: true }), false, "whole numbers");
  assert.equal(ok({ name: "", minSelect: 0, maxSelect: 1, required: false }), false);
  assert.deepEqual([groupType(1), groupType(3), isRequiredGroup(0), isRequiredGroup(2)], ["Single choice", "Multiple choice", false, true]);
});

test("modifier form: a name, and a price change that may be negative (blank = no change)", () => {
  const parse = (input: object) => modifierSchema.safeParse({ groupId: "g1", name: "Large", price: "2", ...input });
  assert.deepEqual(modifierSchema.parse({ groupId: "g1", name: " Large ", price: " 2.50 " }), { groupId: "g1", name: "Large", price: "2.50" });
  assert.equal(modifierSchema.parse({ groupId: "g1", name: "Regular", price: "" }).price, "0");
  for (const price of ["-1", "-1.5", "0", "12", "999.99"]) assert.equal(parse({ price }).success, true, price);
  for (const price of ["abc", "1.234", "--1", "+2", "1,000"]) assert.equal(parse({ price }).success, false, price);
  assert.equal(parse({ name: "" }).success, false);
  assert.equal(parse({ name: "x".repeat(41) }).success, false);
  assert.equal(moveModifierSchema.safeParse({ id: "m1", direction: "up" }).success, true);
  assert.equal(moveModifierSchema.safeParse({ id: "m1", direction: "left" }).success, false);
});

test("price change label: +₦2.00, −₦1.00, No change", () => {
  assert.deepEqual([priceChangeLabel("2.00"), priceChangeLabel("-1.00"), priceChangeLabel("0.00"), priceChangeLabel("0")], ["+₦2.00", "−₦1.00", "No change", "No change"]);
});

test("add ingredient form: an existing ingredient, or a new one with a unit; quantity a whole number > 0", () => {
  const base = { menuItemId: "m1", ingredientId: "", name: "", unit: "", cost: "", quantity: "250" };
  const errors = (input: object) => {
    const r = recipeLineSchema.safeParse({ ...base, ...input });
    return r.success ? null : Object.keys(r.error.flatten().fieldErrors).sort();
  };
  assert.deepEqual(recipeLineSchema.parse({ ...base, ingredientId: "i1" }), { menuItemId: "m1", ingredientId: "i1", name: "", unit: "", cost: null, quantity: "250" });
  assert.equal(errors({ name: "Basmati rice", unit: "kg", cost: "2.20" }), null);
  assert.equal(errors({ name: "Basmati rice", unit: "kg" }), null, "cost is optional");
  assert.deepEqual(errors({}), ["name"], "nothing picked or typed");
  assert.deepEqual(errors({ name: "Basmati rice" }), ["unit"], "a new ingredient needs a unit");
  // Whole units only (stock is counted in whole units): 250 g, not 0.25 kg.
  for (const quantity of ["0", "-1", "0.25", "0.001", "12.5", "1234567", "abc", ""]) assert.deepEqual(errors({ ingredientId: "i1", quantity }), ["quantity"], quantity);
  for (const quantity of ["1", "250", "999999"]) assert.equal(errors({ ingredientId: "i1", quantity }), null, quantity);
  assert.deepEqual(errors({ name: "Rice", unit: "kg", cost: "2.205" }), ["cost"]);
});

test("availability: switched off wins; a recipe needs one serving of every ingredient; no recipe needs its own stock", () => {
  const recipe = (stock: string[]) => stock.map((s, i) => ({ quantity: ["0.25", "1"][i] ?? "1", stock: s }));
  assert.equal(menuAvailability({ isAvailable: false, recipe: recipe(["10", "10"]), ownStock: 5 }), "unavailable");
  assert.equal(menuAvailability({ isAvailable: true, recipe: recipe(["0.25", "1"]), ownStock: 0 }), "available", "exactly one serving");
  assert.equal(menuAvailability({ isAvailable: true, recipe: recipe(["10", "0"]), ownStock: 99 }), "out_of_stock", "an ingredient at zero (its own stock doesn't count)");
  assert.equal(menuAvailability({ isAvailable: true, recipe: recipe(["0.2", "5"]), ownStock: 0 }), "out_of_stock", "below one serving");
  assert.equal(menuAvailability({ isAvailable: true, recipe: [], ownStock: 0 }), "out_of_stock");
  assert.equal(menuAvailability({ isAvailable: true, recipe: [], ownStock: 1 }), "available");
  assert.deepEqual(AVAILABILITY_TAG, {
    unavailable: { tag: "Unavailable", title: "Currently unavailable" },
    out_of_stock: { tag: "Out of stock", title: "Out of stock in this warehouse" },
  });
});
