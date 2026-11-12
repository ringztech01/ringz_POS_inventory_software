import { prisma } from "@/lib/db";
import { withCheck } from "../lib/orderLines";
import { PREBILL } from "@/lib/hardware/assignments";
import { currentDeviceId } from "@/lib/hardware/device";
import { printerFor } from "@/lib/hardware/printQueue";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { guardPage } from "../server/guard";
import { redirect } from "next/navigation";
import { noteFloorViewer } from "../server/floorPresence";
import { getServiceRoutes } from "../server/serviceView";
import { getFloor } from "../server/queries/floor";
import { getCounterOrders, getPosSettings, getPosStaff } from "../server/queries/posScreen";
import PosFloor, { type FromOrder } from "../components/pos/PosFloor";
import { getPosSessionInfo } from "../server/posSessionInfo";

// /pos/floor[?area=][&from=<orderId>] — the floor plan full screen for the
// touch POS (Restaurant mode): tables, open takeaways and bar tabs. Needs
// Manage Orders (a 404 while the module is off).
export default async function PosFloorPage({ searchParams }: { searchParams: Promise<{ area?: string; from?: string }> }) {
  const denied = await guardPage(P.MANAGE_ORDERS);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const { area, from } = await searchParams;
  // The Classic view (Part 6f): its own tables screen instead.
  const routes = await getServiceRoutes();
  if (routes.view !== "SERVICE") redirect(routes.tables({ areaId: typeof area === "string" ? area : null }));
  // This screen is showing the floor (each 5 s refresh): counted in the
  // editor's "N tablets updated".
  await noteFloorViewer();
  const current = await getCurrentUserPermissions();
  const deviceId = await currentDeviceId();
  const [floor, counter, settings, staff, user, fromOrder, prebill] = await Promise.all([
    getFloor(area),
    getCounterOrders(),
    getPosSettings(),
    getPosStaff(),
    current.userId ? prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, firstName: true, lastName: true } }) : null,
    typeof from === "string" && from
      ? prisma.order.findFirst({ where: { id: from, deletedAt: null }, select: { id: true, type: true, tabName: true, checkNumber: true, checkName: true, table: { select: { name: true } } } })
      : null,
    printerFor(PREBILL, deviceId),
  ]);
  const back: FromOrder | null = fromOrder ? { id: fromOrder.id, tableName: fromOrder.table ? withCheck(fromOrder.table.name, fromOrder) : null, type: fromOrder.type, tabName: fromOrder.tabName } : null;

  return (
    <PosFloor
      floor={floor}
      counter={counter}
      from={back}
      can={{
        orders: current.permissions.has(P.MANAGE_ORDERS),
        book: current.permissions.has(P.MANAGE_RESERVATIONS),
        kitchen: current.permissions.has(P.KITCHEN_DISPLAY),
        settle: current.permissions.has(P.SETTLE_BILL),
      }}
      prebill={prebill}
      user={{ id: user?.id ?? "", name: user ? `${user.firstName} ${user.lastName}`.trim() : "" }}
      settings={settings}
      session={await getPosSessionInfo(current, settings)}
      staff={staff}
      leaveHref={current.serviceOnly ? null : current.permissions.has(P.RESTAURANT_DASHBOARD) ? "/restaurant" : "/dashboard"}
    />
  );
}
