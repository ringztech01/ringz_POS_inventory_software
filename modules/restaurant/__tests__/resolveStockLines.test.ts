// Run with: npx tsx --test modules/restaurant/__tests__/resolveStockLines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { resolveStockLines, type SoldLine } from "../lib/resolveStockLines";

// Plain [id, quantity] pairs for comparing.
const plain = (lines: SoldLine[]) => resolveStockLines(lines).map((m) => [m.productId, m.quantity.toString()]);

const jollofRecipe = [
  { ingredientId: "rice", ingredientName: "Basmati rice", quantity: "1" },
  { ingredientId: "tomato", ingredientName: "Tomato", quantity: "2" },
];

test("a STANDARD (retail) product passes through untouched", () => {
  assert.deepEqual(plain([{ productId: "soap", productName: "Soap", productType: "STANDARD", quantity: 3 }]), [["soap", "3"]]);
  // Even if it somehow carried recipe lines, a non-menu product is never expanded.
  assert.deepEqual(plain([{ productId: "soap", productName: "Soap", productType: "STANDARD", quantity: 1, recipe: jollofRecipe }]), [["soap", "1"]]);
});

test("a menu item with no recipe passes through untouched (it tracks its own stock)", () => {
  assert.deepEqual(plain([{ productId: "water", productName: "Bottled Water", productType: "MENU_ITEM", quantity: 2 }]), [["water", "2"]]);
  assert.deepEqual(plain([{ productId: "water", productName: "Bottled Water", productType: "MENU_ITEM", quantity: 2, recipe: [] }]), [["water", "2"]]);
});

test("a menu item with a recipe expands into its ingredient lines", () => {
  const moves = resolveStockLines([{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 1, recipe: jollofRecipe }]);
  assert.deepEqual(moves.map((m) => [m.productId, m.productName, m.quantity.toString()]), [["rice", "Basmati rice", "1"], ["tomato", "Tomato", "2"]]);
  assert.ok(moves.every((m) => m.quantity instanceof Decimal), "Decimal quantities");
  assert.ok(!moves.some((m) => m.productId === "jollof"), "the dish itself isn't deducted");
});

test("qty > 1 multiplies: 2× Jollof (1 kg rice + 2 tomatoes each) → 2 kg rice, 4 tomatoes", () => {
  assert.deepEqual(plain([{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 2, recipe: jollofRecipe }]), [["rice", "2"], ["tomato", "4"]]);
});

test("decimal quantities are never rounded", () => {
  const recipe = [{ ingredientId: "rice", ingredientName: "Basmati rice", quantity: "0.333" }, { ingredientId: "chicken", ingredientName: "Chicken", quantity: "0.25" }];
  assert.deepEqual(plain([{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 3, recipe }]), [["chicken", "0.75"], ["rice", "0.999"]]);
  assert.deepEqual(plain([{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: "2", recipe: [{ ingredientId: "oil", ingredientName: "Oil", quantity: new Decimal("0.0005") }] }]), [["oil", "0.001"]]);
});

test("the same product from several lines is one move; a mixed order; sorted by product id", () => {
  const friedRice = [{ ingredientId: "rice", ingredientName: "Basmati rice", quantity: "0.5" }];
  assert.deepEqual(
    plain([
      { productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 2, recipe: jollofRecipe },
      { productId: "fried", productName: "Fried rice", productType: "MENU_ITEM", quantity: 1, recipe: friedRice },
      { productId: "water", productName: "Bottled Water", productType: "MENU_ITEM", quantity: 3 },
      { productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 1, recipe: jollofRecipe },
      { productId: "tomato", productName: "Tomato", productType: "INGREDIENT", quantity: 1 },
    ]),
    [["rice", "3.5"], ["tomato", "7"], ["water", "3"]],
  );
});

test("nothing sold, nothing moved; lines of zero are skipped; the input isn't changed", () => {
  assert.deepEqual(resolveStockLines([]), []);
  assert.deepEqual(plain([{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 0, recipe: jollofRecipe }]), []);
  const input: SoldLine[] = [{ productId: "jollof", productName: "Jollof", productType: "MENU_ITEM", quantity: 2, recipe: jollofRecipe }];
  const copy = JSON.stringify(input);
  resolveStockLines(input);
  assert.equal(JSON.stringify(input), copy);
});
