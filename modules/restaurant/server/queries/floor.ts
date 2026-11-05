import "server-only";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { orderRef } from "../../lib/format";
import { lineAmount, orderTotals } from "../../lib/orderTotals";
import { TABLE_STATUSES, tableStatus, type TableStatus } from "../../lib/tableStatus";
import { formatAppTime, formatOpenFor } from "../../lib/time";
import { getTableStatusRules } from "../rules";
import { byFloorOrder, tableStateSelect } from "./tables";

export type FloorOrder = {
  id: string;
  ref: string;
  // Sent with Move / Merge (the order's version check).
  version: number;
  warehouseId: string;
  waiter: string | null;
  guests: number;
  // Formatted on the server from lib/pricing — the browser never totals.
  total: string;
  // "6m", "1h 12m".
  open: string;
  lines: { id: string; quantity: number; name: string; amount: string }[];
  // Dishes the kitchen has finished, waiting to be served (the card's dot).
  ready: number;
};

export type FloorTable = {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  order: FloorOrder | null;
  // The booking that's due, if any.
  reservation: { id: string; guestName: string; partySize: number; time: string } | null;
};

// Every active table (all areas), for the Move / Merge pickers.
export type FloorTarget = {
  id: string;
  name: string;
  areaName: string;
  warehouseId: string;
  status: TableStatus;
  // Occupied: its order.
  orderId: string | null;
  orderRef: string | null;
  // Reserved: "Okafor · 19:30", for the warning.
  booking: string | null;
};

export type FloorData = {
  areas: { id: string; name: string }[];
  areaId: string | null;
  // Every active table, all areas.
  legend: Record<TableStatus, number>;
  // The selected area's tables, in floor order.
  tables: FloorTable[];
  targets: FloorTarget[];
};

// The floor plan: every table's status from tableStatus (for the legend),
// and for the selected area (?area, else the first) the details each card
// and the side panel show. Deleted tables and areas never appear.
export async function getFloor(areaParam?: string): Promise<FloorData> {
  const now = new Date();
  const [rules, settings] = await Promise.all([getTableStatusRules(), getBusinessSettings()]);
  const [areas, tables] = await Promise.all([
    prisma.diningArea.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.table.findMany({
      where: { deletedAt: null, area: { deletedAt: null } },
      select: {
        id: true,
        name: true,
        seats: true,
        areaId: true,
        area: { select: { sortOrder: true, createdAt: true, name: true, warehouseId: true } },
        ...tableStateSelect(now, rules),
      },
    }),
  ]);
  const areaId = areas.some((area) => area.id === areaParam) ? (areaParam ?? null) : (areas[0]?.id ?? null);

  const states = tables.flatMap((table) => {
    const state = tableStatus(table, rules, now);
    return state ? [{ table, state }] : [];
  });
  const legend = Object.fromEntries(TABLE_STATUSES.map((status) => [status, 0])) as Record<TableStatus, number>;
  for (const { state } of states) legend[state.status]++;

  const sorted = [...states].sort((a, b) => byFloorOrder(a.table, b.table));
  const here = sorted.filter(({ table }) => table.areaId === areaId);
  // Every occupied table's order (the pickers show their references).
  const orderIds = states.flatMap(({ state }) => (state.order ? [state.order.id] : []));
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          number: true,
          version: true,
          warehouseId: true,
          guests: true,
          openedAt: true,
          discountType: true,
          discountValue: true,
          serviceCharge: true,
          waiter: { select: { firstName: true } },
          items: {
            where: { deletedAt: null, cancelledAt: null },
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              taxType: true,
              taxRate: true,
              cancelledAt: true,
              deletedAt: true,
              kitchenStatus: true,
              product: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];
  const byId = new Map(orders.map((order) => [order.id, order]));

  return {
    areas,
    areaId,
    legend,
    tables: here.map(({ table, state }) => {
      const order = state.order ? byId.get(state.order.id) : undefined;
      return {
        id: table.id,
        name: table.name,
        seats: table.seats,
        status: state.status,
        order: order
          ? {
              id: order.id,
              ref: orderRef(order.number),
              version: order.version,
              warehouseId: order.warehouseId,
              waiter: order.waiter?.firstName ?? null,
              guests: order.guests,
              // The ticket's Total (service charge and tax included).
              total: formatNaira(orderTotals(order.items, settings.restaurantServiceChargePercent, order).total.toFixed(2)),
              open: formatOpenFor(Math.max(0, Math.floor((now.getTime() - order.openedAt.getTime()) / 60_000))),
              lines: order.items.map((line) => ({
                id: line.id,
                quantity: line.quantity,
                name: line.product.name,
                amount: formatNaira(lineAmount(line).toFixed(2)),
              })),
              ready: order.items.filter((line) => line.kitchenStatus === "READY").reduce((sum, line) => sum + line.quantity, 0),
            }
          : null,
        reservation: state.reservation
          ? {
              id: state.reservation.id,
              guestName: state.reservation.guestName,
              partySize: state.reservation.partySize,
              time: formatAppTime(state.reservation.startsAt),
            }
          : null,
      };
    }),
    targets: sorted.map(({ table, state }) => {
      const order = state.order ? byId.get(state.order.id) : undefined;
      return {
        id: table.id,
        name: table.name,
        areaName: table.area.name,
        warehouseId: table.area.warehouseId,
        status: state.status,
        orderId: order?.id ?? null,
        orderRef: order ? orderRef(order.number) : null,
        booking: state.reservation ? `${state.reservation.guestName} · ${formatAppTime(state.reservation.startsAt)}` : null,
      };
    }),
  };
}
