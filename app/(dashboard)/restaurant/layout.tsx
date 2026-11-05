import type { ReactNode } from "react";
import { requireRestaurant } from "@/modules/restaurant/server/guard";
import RestaurantHeader from "@/modules/restaurant/components/RestaurantHeader";

// The Restaurant module (modules/restaurant). 404 while it's switched off.
export default async function RestaurantLayout({ children }: { children: ReactNode }) {
  await requireRestaurant();
  return (
    <>
      <RestaurantHeader />
      {children}
    </>
  );
}
