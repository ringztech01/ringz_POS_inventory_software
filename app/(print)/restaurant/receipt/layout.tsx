import type { ReactNode } from "react";
import { guardPage } from "@/modules/restaurant/server/guard";
import { RESTAURANT_PERMISSIONS } from "@/modules/restaurant/manifest";

// Restaurant receipts: on top of the print layout's sign-in check, 404 while
// the Restaurant module is off and the Manage Orders permission.
export default async function ReceiptLayout({ children }: { children: ReactNode }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
  return denied ?? children;
}
