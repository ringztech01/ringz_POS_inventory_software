import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getIngredientOptions, getRecipe, getRecipeItems, getUnitNames } from "../server/queries/recipes";
import FoodTabs from "../components/food/FoodTabs";
import RecipesPanel from "../components/food/RecipesPanel";

// /restaurant/food/recipes[?item=] — Food › Recipes: one menu item's recipe
// (an unknown or missing item means the first). Needs Manage Food.
export default async function FoodRecipesPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;

  const { item } = await searchParams;
  const [items, ingredients, units] = await Promise.all([getRecipeItems(), getIngredientOptions(), getUnitNames()]);
  const itemId = items.find((i) => i.id === item)?.id ?? items[0]?.id ?? null;
  const recipe = itemId ? await getRecipe(itemId) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>Food</h1>
        <FoodTabs active="recipes" />
      </div>
      <RecipesPanel items={items} recipe={recipe} ingredients={ingredients} units={units} />
    </div>
  );
}
