import { RESTAURANT_PERMISSIONS, type RestaurantPermission } from "../manifest";

// The Food screen's tabs (RingzPOS Food Management design): Menu items,
// Modifiers, Recipes, Waste — each its own route, shown to those who may
// open it (Manage Food; Waste: Log Waste or Approve Waste).
const P = RESTAURANT_PERMISSIONS;
export const FOOD_TABS = [
  { key: "items", label: "Menu items", href: "/restaurant/food/items", permissions: [P.MANAGE_FOOD] },
  { key: "modifiers", label: "Modifiers", href: "/restaurant/food/modifiers", permissions: [P.MANAGE_FOOD] },
  { key: "recipes", label: "Recipes", href: "/restaurant/food/recipes", permissions: [P.MANAGE_FOOD] },
  { key: "waste", label: "Waste", href: "/restaurant/food/waste", permissions: [P.LOG_WASTE, P.APPROVE_WASTE] },
] as const satisfies readonly { key: string; label: string; href: string; permissions: readonly RestaurantPermission[] }[];

export type FoodTab = (typeof FOOD_TABS)[number]["key"];

// The tabs these permissions open, in order (/restaurant/food opens the first).
export function visibleFoodTabs(permissions: ReadonlySet<string>) {
  return FOOD_TABS.filter((tab) => tab.permissions.some((p) => permissions.has(p)));
}

// Every permission that opens a Food tab (the Food link and /restaurant/food).
export const FOOD_PERMISSIONS: readonly RestaurantPermission[] = [...new Set(FOOD_TABS.flatMap((tab) => tab.permissions))];
