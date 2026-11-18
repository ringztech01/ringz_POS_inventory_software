import { redirect } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { requireRestaurant } from "../server/guard";
import { DigitalMenuPage as DigitalMenuStub } from "./stubs";

// /restaurant/digital-menu — the Digital menu's settings. For now its one
// part is QR codes (Part 8 Step 2): the Administrator and Manage Floor Plan
// go straight there; others (Manage Food) see the placeholder until the
// menu's own settings arrive.
export default async function DigitalMenuPage() {
  await requireRestaurant();
  const current = await getCurrentUserPermissions();
  if (current.userId && (current.isAdmin || current.permissions.has(RESTAURANT_PERMISSIONS.MANAGE_FLOOR_PLAN))) redirect("/restaurant/digital-menu/qr-codes");
  return DigitalMenuStub();
}
