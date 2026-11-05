import type { ReactNode } from "react";
import { RESTAURANT_PERMISSIONS as P, type RestaurantPermission } from "../manifest";
import { guardPage } from "../server/guard";
import RestaurantStub from "../components/RestaurantStub";

// The restaurant screens not built yet. Each is guarded with the permission
// its tab needs (see the manifest's nav), so the route works end to end.

async function stubPage(title: string, permission: RestaurantPermission): Promise<ReactNode> {
  return (await guardPage(permission)) ?? <RestaurantStub title={title} />;
}

export async function OrdersPage() {
  return stubPage("Orders", P.MANAGE_ORDERS);
}

export async function DigitalMenuPage() {
  return stubPage("Digital menu", P.MANAGE_FOOD);
}
