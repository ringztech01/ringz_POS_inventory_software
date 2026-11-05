"use server";

import { revalidatePath } from "next/cache";
import { invalid } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { recipeLineSchema } from "../../schemas/recipe";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import * as recipes from "../services/recipes";

// Thin wrappers for Food › Recipes: Manage Food, input parsing and refresh
// here; the rules are in services/recipes.ts.

const requireManageFood = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
// Recipes show on the Recipes and Menu items tabs (food cost, margin).
const refresh = () => revalidatePath("/restaurant", "layout");

export async function addRecipeLine(input: unknown): Promise<recipes.RecipeResult> {
  return safely("add recipe line", async (): Promise<recipes.RecipeResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = recipeLineSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await recipes.addRecipeLine(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteRecipeLine(rawId: unknown): Promise<recipes.RecipeResult> {
  return safely("delete recipe line", async (): Promise<recipes.RecipeResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: recipes.RECIPE_LINE_GONE };

    const result = await recipes.deleteRecipeLine(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}
