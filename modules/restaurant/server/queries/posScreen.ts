import "server-only";
import { prisma } from "@/lib/db";
import type { OrderType } from "@prisma/client";
import { BUSINESS_SETTINGS_ID, getBusinessSettings } from "@/lib/business-settings";
import { orderRef } from "../../lib/format";
import { noTableLabel } from "../../lib/orderLines";
import { formatOpenFor } from "../../lib/time";
import { canTakeOrdersWhere } from "../services/orders";
import { getMenu, type OrderScreenData } from "./orderScreen";

// The touch POS's menu before an order is open: stock as the restaurant's
// warehouse holds it (Settings), else the first dining area's (with no
// warehouse at all, every dish shows as out of stock).
export async function getPosMenu(): Promise<OrderScreenData["menu"]> {
  const settings = await getBusinessSettings();
  const warehouseId =
    settings.restaurantWarehouseId ??
    (await prisma.diningArea.findFirst({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { warehouseId: true } }))?.warehouseId ??
    "";
  return (await getMenu(warehouseId)).menu;
}

// lockSeconds: service staff's auto-lock (0: never — then nobody's screen
// locks by itself); lockSecondsManager: Managers' and the Administrator's
// (Part 6f Step 6).
export type PosSettings = { returnHome: boolean; sendToFloor: boolean; lockSeconds: number; lockSecondsManager: number; lightTheme: boolean };

// The touch POS's own settings (Restaurant › Touch POS), read on their own.
export async function getPosSettings(): Promise<PosSettings> {
  const row = await prisma.businessSetting.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: { restaurantPosReturnHome: true, restaurantPosSendToFloor: true, restaurantPosLockSeconds: true, restaurantPosLockSecondsManager: true, restaurantPosLightTheme: true },
  });
  return {
    returnHome: row?.restaurantPosReturnHome ?? false,
    sendToFloor: row?.restaurantPosSendToFloor ?? true,
    lockSeconds: row?.restaurantPosLockSeconds ?? 0,
    lockSecondsManager: row?.restaurantPosLockSecondsManager ?? 300,
    lightTheme: row?.restaurantPosLightTheme ?? false,
  };
}

// role: "Waiter", "Manager" — under the name on the PIN screen.
export type PosStaff = { id: string; name: string; role?: string; colour?: string | null };

// Who can take over the till: people who take orders and have set a PIN
// (and how many take orders without one).
export async function getPosStaff(): Promise<{ staff: PosStaff[]; withoutPin: number }> {
  const [staff, withoutPin] = await Promise.all([
    prisma.user.findMany({
      where: { ...canTakeOrdersWhere(), approvalPin: { isNot: null } },
      select: { id: true, firstName: true, lastName: true, userRole: { select: { name: true } } },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.user.count({ where: { ...canTakeOrdersWhere(), approvalPin: { is: null } } }),
  ]);
  return { staff: staff.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName.slice(0, 1)}${u.lastName ? "." : ""}`.trim(), role: u.userRole?.name })), withoutPin };
}

export type CounterOrder = { id: string; ref: string; label: string; type: OrderType; open: string; lines: number; waiter: string | null; training: boolean };

// Open orders with no table (takeaways, bar tabs, deliveries), oldest
// first — to pick up again from the touch POS's floor plan.
export async function getCounterOrders(): Promise<CounterOrder[]> {
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, tableId: null, status: { in: ["OPEN", "SENT", "SERVED"] } },
    select: { id: true, number: true, type: true, tabName: true, openedAt: true, training: true, waiter: { select: { firstName: true } }, _count: { select: { items: { where: { deletedAt: null, cancelledAt: null } } } } },
    orderBy: [{ openedAt: "asc" }, { number: "asc" }],
    take: 40,
  });
  const now = Date.now();
  return orders.map((o) => ({
    id: o.id,
    ref: orderRef(o.number),
    label: noTableLabel(o.type, o.tabName),
    type: o.type,
    open: formatOpenFor(Math.max(0, Math.floor((now - o.openedAt.getTime()) / 60_000))),
    lines: o._count.items,
    waiter: o.waiter?.firstName ?? null,
    training: o.training,
  }));
}
