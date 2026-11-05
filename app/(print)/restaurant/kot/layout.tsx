import type { ReactNode } from "react";
import { guardPage } from "@/modules/restaurant/server/guard";
import { RESTAURANT_PERMISSIONS } from "@/modules/restaurant/manifest";

// Printed kitchen tickets: on top of the print layout's sign-in check, 404
// while the Restaurant module is off and the Kitchen Display permission.
export default async function KotLayout({ children }: { children: ReactNode }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY);
  return denied ?? children;
}
