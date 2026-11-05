import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { readKdsFilter } from "../lib/kds";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { guardPage } from "../server/guard";
import { stationPrinters } from "@/lib/hardware/printQueue";
import { getKitchenBoard, getKitchenStations } from "../server/queries/kds";
import KitchenBoard from "../components/kitchen/KitchenBoard";

// /restaurant/kitchen[?station=KIT&view=active|done] — the kitchen display,
// full screen (app/(kds)). Kitchen Display opens it; Manage Kitchen changes
// lines, bumps and recalls (read-only without). Log Waste adds the header's
// Log waste and each line's Remake.
export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ station?: string; view?: string }> }) {
  const denied = await guardPage(P.KITCHEN_DISPLAY);
  if (denied) return denied;

  const [{ permissions }, stations] = await Promise.all([getCurrentUserPermissions(), getKitchenStations()]);
  const filter = readKdsFilter(await searchParams, stations.map((s) => s.code));
  const [board, printers] = await Promise.all([getKitchenBoard(filter), stationPrinters()]);
  return <KitchenBoard data={{ ...board, stations }} canManage={permissions.has(P.MANAGE_KITCHEN)} canWaste={permissions.has(P.LOG_WASTE)} printers={printers} />;
}
