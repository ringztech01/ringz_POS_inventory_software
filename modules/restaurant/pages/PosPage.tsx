import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PREBILL, RECEIPT } from "@/lib/hardware/assignments";
import { currentDeviceId } from "@/lib/hardware/device";
import { printerFor } from "@/lib/hardware/printQueue";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getDiscountApprovers, getDrawerApprovers, getVoidApprovers, getWasteApprovers } from "../server/queries/approvers";
import { drawerPrinterFor } from "@/lib/hardware/drawer";
import { PERMISSIONS } from "@/lib/permissions";
import { getBill } from "../server/queries/bill";
import { getQuickNotes } from "../server/queries/menuGroups";
import { getOrderScreen } from "../server/queries/orderScreen";
import { getPosMenu, getPosSettings, getPosStaff } from "../server/queries/posScreen";
import { getRefundView } from "../server/queries/refund";
import RestaurantPos, { type LoadedOrder } from "../components/pos/RestaurantPos";
import { getPosSessionInfo } from "../server/posSessionInfo";

// /pos while the Restaurant module is on (Part 6e): the touch POS. With
// ?order=<id> it opens that order (as the order screen loads it), otherwise
// the menu with no table yet. Needs Manage Orders.
export default async function PosPage({ orderId, openPay = false }: { orderId: string | null; openPay?: boolean }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const current = await getCurrentUserPermissions();
  const user = current.userId ? await prisma.user.findUnique({ where: { id: current.userId }, select: { id: true, firstName: true, lastName: true } }) : null;
  const order = orderId ? await loadOrder(orderId, current.permissions) : null;
  const deviceId = await currentDeviceId();
  const [menu, settings, quickNotes, staff, drawerPrinter] = await Promise.all([
    order ? order.data.menu : getPosMenu(),
    getPosSettings(),
    order ? getQuickNotes() : Promise.resolve([]),
    getPosStaff(),
    drawerPrinterFor(deviceId),
  ]);
  // Open drawer: on a till with a drawer — straight away with Open Drawer,
  // otherwise with the PIN of someone who has it.
  const drawer = drawerPrinter ? { approvers: await getDrawerApprovers() } : null;
  const session = await getPosSessionInfo(current, settings);

  return (
    <RestaurantPos
      order={order}
      openPay={openPay}
      menu={menu}
      user={{ id: user?.id ?? "", name: user ? `${user.firstName} ${user.lastName}`.trim() : "" }}
      missing={!!orderId && !order}
      settings={settings}
      session={session}
      quickNotes={quickNotes}
      staff={staff}
      can={{
        kitchen: current.permissions.has(RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY),
        sales: current.permissions.has(PERMISSIONS.MANAGE_SALE),
        dashboard: current.permissions.has(RESTAURANT_PERMISSIONS.RESTAURANT_DASHBOARD),
        backOffice: !current.serviceOnly,
      }}
      drawer={drawer}
    />
  );
}

async function loadOrder(id: string, permissions: ReadonlySet<string>): Promise<LoadedOrder | null> {
  const [data, bill, approvers, voidApprovers] = await Promise.all([getOrderScreen(id), getBill(id), getDiscountApprovers(), getVoidApprovers()]);
  if (!data || !bill) return null;
  const canWaste = permissions.has(RESTAURANT_PERMISSIONS.LOG_WASTE);
  const canSettle = permissions.has(RESTAURANT_PERMISSIONS.SETTLE_BILL);
  const deviceId = await currentDeviceId();
  const [wasteApprovers, refundView, prebill, receipt] = await Promise.all([
    canWaste ? getWasteApprovers() : Promise.resolve([]),
    data.order.status === "BILLED" ? getRefundView(id) : Promise.resolve(null),
    printerFor(PREBILL, deviceId),
    printerFor(RECEIPT, deviceId),
  ]);
  return {
    data,
    bill,
    approvers,
    voidApprovers,
    waste: canWaste ? { approvers: wasteApprovers } : null,
    printers: { prebill, receipt },
    canSettle,
    refundView,
  };
}
