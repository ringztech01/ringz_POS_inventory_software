import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import type { RecipeLineField, RecipeLineInput } from "../../schemas/recipe";
import { lockMenuItem } from "../locks";
import { isUniqueViolation } from "../prismaErrors";

// Food › Recipes: the rules behind adding and removing recipe lines —
// without the permission check and input parsing (../actions/recipes.ts).
// Every write locks the menu item first. Costs aren't stored on the lines:
// a line costs its quantity × the ingredient's current cost, worked out on
// read. Nothing here touches stock (recipes are deducted at settle, Part 6).

export type RecipeResult = ActionResult<RecipeLineField>;

export const RECIPE_ITEM_GONE = "Menu item not found. It may have been deleted.";
export const RECIPE_LINE_GONE = "That recipe line is already gone — refreshed.";
const INGREDIENTS_CATEGORY = "Ingredients";

// Next free "IN-001"-style code (across every product, deleted ones too).
async function nextIngredientCode(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS n FROM Product WHERE code REGEXP '^IN-[0-9]+$'`;
  return `IN-${String(Number(rows[0]?.n ?? 0) + 1).padStart(3, "0")}`;
}

// A new INGREDIENT product: category "Ingredients", brand "Restaurant",
// its unit (found or made by name), cost per unit, price 0, no stock rows.
async function createIngredient(tx: Prisma.TransactionClient, name: string, unitName: string, cost: string | null) {
  const category =
    (await tx.category.findFirst({ where: { name: INGREDIENTS_CATEGORY, deletedAt: null }, select: { id: true } })) ??
    (await tx.category.create({ data: { name: INGREDIENTS_CATEGORY }, select: { id: true } }));
  const brand =
    (await tx.brand.findFirst({ where: { name: "Restaurant", deletedAt: null }, select: { id: true } })) ??
    (await tx.brand.create({ data: { name: "Restaurant" }, select: { id: true } }));
  const unit =
    (await tx.unit.findFirst({ where: { name: unitName, deletedAt: null }, select: { id: true } })) ??
    (await tx.unit.create({ data: { name: unitName }, select: { id: true } }));
  return tx.product.create({
    data: {
      name,
      code: await nextIngredientCode(tx),
      price: "0",
      cost,
      categoryId: category.id,
      brandId: brand.id,
      unitId: unit.id,
      taxType: "EXCLUSIVE",
      productType: "INGREDIENT",
    },
    select: { id: true },
  });
}

// Add ingredient: an existing INGREDIENT, or a new one (a name that matches
// an existing ingredient, any case, uses that one). One line per ingredient.
export async function addRecipeLine(input: RecipeLineInput): Promise<RecipeResult> {
  const attempt = () =>
    prisma.$transaction(async (tx): Promise<RecipeResult> => {
      if (!(await lockMenuItem(tx, input.menuItemId))) return { ok: false, error: RECIPE_ITEM_GONE };

      let ingredientId = input.ingredientId;
      if (ingredientId) {
        const found = await tx.product.findFirst({ where: { id: ingredientId, productType: "INGREDIENT", deletedAt: null }, select: { id: true } });
        if (!found) return invalid<RecipeLineField>({ name: ["That ingredient no longer exists. Pick another."] });
      } else {
        const existing = await tx.product.findFirst({ where: { name: input.name, productType: "INGREDIENT", deletedAt: null }, select: { id: true } });
        ingredientId = existing?.id ?? (await createIngredient(tx, input.name, input.unit, input.cost)).id;
      }

      const already = await tx.recipeLine.findFirst({ where: { menuItemId: input.menuItemId, ingredientId, deletedAt: null }, select: { id: true } });
      if (already) return invalid<RecipeLineField>({ name: ["It's already in this recipe. Delete that line to change its quantity."] });
      await tx.recipeLine.create({ data: { menuItemId: input.menuItemId, ingredientId, quantity: input.quantity } });
      return { ok: true };
    });
  try {
    return await attempt();
  } catch (error) {
    // Two new ingredients took the same IN- code at once: the next try gets the next one.
    if (isUniqueViolation(error, "code")) return attempt();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return attempt();
    throw error;
  }
}

// Delete a line (soft delete). The item's food cost follows on the next read.
export async function deleteRecipeLine(lineId: string): Promise<RecipeResult> {
  return prisma.$transaction(async (tx): Promise<RecipeResult> => {
    const line = await tx.recipeLine.findFirst({ where: { id: lineId, deletedAt: null }, select: { menuItemId: true } });
    if (!line) return { ok: false, error: RECIPE_LINE_GONE };
    if (!(await lockMenuItem(tx, line.menuItemId))) return { ok: false, error: RECIPE_ITEM_GONE };
    const removed = await tx.recipeLine.updateMany({ where: { id: lineId, deletedAt: null }, data: { deletedAt: new Date() } });
    return removed.count === 1 ? { ok: true } : { ok: false, error: RECIPE_LINE_GONE };
  });
}
