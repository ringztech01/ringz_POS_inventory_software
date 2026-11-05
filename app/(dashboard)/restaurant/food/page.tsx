import { redirect } from "next/navigation";

// Food opens on its first tab, Menu items.
export default function FoodPage() {
  redirect("/restaurant/food/items");
}
