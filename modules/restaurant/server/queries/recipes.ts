import "server-only";
import { prisma } from "@/lib/db";
import { foodCost, marginPercent, recipeLineCost, trimQuantity } from "../../lib/foodCost";

// Food › Recipes: the menu items to pick from, one item's recipe with its
// costs (worked out here from each ingredient's current cost), and the
// ingredients and units the Add form suggests.

export type RecipeItemOption = { id: string; code: string; name: string };

export type RecipeLineRow = {
  id: string;
  ingredient: string;
  quantity: string;
  unit: string;
  // The ingredient's cost per unit (2dp); null = no cost set (counts as 0).
  unitCost: string | null;
  lineCost: string;
  // Saved before recipes took whole units only (0.25 kg): settling a bill
  // with this dish is refused until it's re-entered in a small unit.
  partUnit: boolean;
};

export type RecipeView = {
  item: { id: string; code: string; name: string; price: string };
  lines: RecipeLineRow[];
  // null with no lines (the item tracks its own stock).
  foodCost: string | null;
  margin: number | null;
};

export type IngredientOption = { id: string; name: string; code: string; unit: string; cost: string | null };

export async function getRecipeItems(): Promise<RecipeItemOption[]> {
  return prisma.product.findMany({
    where: { productType: "MENU_ITEM", deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true },
  });
}

export async function getRecipe(menuItemId: string): Promise<RecipeView | null> {
  const item = await prisma.product.findFirst({
    where: { id: menuItemId, productType: "MENU_ITEM", deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      price: true,
      recipeLines: {
        where: { deletedAt: null, ingredient: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, quantity: true, ingredient: { select: { name: true, cost: true, unit: { select: { name: true } } } } },
      },
    },
  });
  if (!item) return null;
  const lines = item.recipeLines.map((line) => ({
    id: line.id,
    ingredient: line.ingredient.name,
    quantity: trimQuantity(line.quantity),
    partUnit: !line.quantity.isInteger(),
    unit: line.ingredient.unit.name,
    unitCost: line.ingredient.cost?.toFixed(2) ?? null,
    lineCost: recipeLineCost(line.quantity, line.ingredient.cost).toFixed(2),
  }));
  const cost = lines.length ? foodCost(item.recipeLines.map((l) => ({ quantity: l.quantity, unitCost: l.ingredient.cost }))) : null;
  return {
    item: { id: item.id, code: item.code, name: item.name, price: item.price.toFixed(2) },
    lines,
    foodCost: cost ? cost.toFixed(2) : null,
    margin: cost ? marginPercent(item.price, cost) : null,
  };
}

export async function getIngredientOptions(): Promise<IngredientOption[]> {
  const ingredients = await prisma.product.findMany({
    where: { productType: "INGREDIENT", deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, cost: true, unit: { select: { name: true } } },
  });
  return ingredients.map((i) => ({ id: i.id, name: i.name, code: i.code, unit: i.unit.name, cost: i.cost?.toFixed(2) ?? null }));
}

// Units offered for a new ingredient: the app's units, plus the common
// kitchen ones.
export async function getUnitNames(): Promise<string[]> {
  const units = await prisma.unit.findMany({ where: { deletedAt: null }, select: { name: true } });
  const names = new Set(["kg", "g", "L", "ml", "pc", "portion", ...units.map((u) => u.name)]);
  return [...names];
}
