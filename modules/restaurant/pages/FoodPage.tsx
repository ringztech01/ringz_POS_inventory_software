import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { FOOD_PERMISSIONS, visibleFoodTabs } from "../lib/foodTabs";
import { guardPageAny } from "../server/guard";

// /restaurant/food — opens the first Food tab this user may see (Menu items
// with Manage Food; Waste with only Log or Approve Waste).
export default async function FoodPage() {
  const denied = await guardPageAny(FOOD_PERMISSIONS);
  if (denied) return denied;
  const { permissions } = await getCurrentUserPermissions();
  redirect(visibleFoodTabs(permissions)[0]?.href ?? "/restaurant");
}
