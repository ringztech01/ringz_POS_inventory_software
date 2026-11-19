import "server-only";
import type { KitchenStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { orderRef } from "../../lib/format";
import { isLate } from "../../lib/kds";
import { withCheck } from "../../lib/orderLines";
import { lineAmount, orderTotals } from "../../lib/orderTotals";
import type { FixtureType, TableShape } from "../../lib/floorGeometry";
import { TABLE_STATUSES, tableStatus, type TableStatus } from "../../lib/tableStatus";
import { activeRequestWhere, type FloorRequest } from "../../lib/tableRequests";
import { autoFloor, planSaved } from "../../lib/floorAuto";
import type { FloorGuestOrder, PendingGuestLine } from "../../lib/guestOrdering";
import { lineDetail, noTableLabel, readModifiers } from "../../lib/orderLines";
import { formatAppTime, formatOpenFor } from "../../lib/time";
import { getTableStatusRules } from "../rules";
import { byFloorOrder, tableStateSelect } from "./tables";

// A line with no station: the stations' own default late time.
const DEFAULT_LATE_MIN = 15;

// A shared table's colour: its most pressing check's.
const STAGE_ORDER: FloorStage[] = ["LATE", "SENT", "SEATED", "BILL"];
function worstStage(stages: FloorStage[]): FloorStage {
  return STAGE_ORDER.find((stage) => stages.includes(stage)) ?? "SEATED";
}

// Where an occupied table's order is (the POS Tables design's colours):
//   SEATED   nothing sent to the kitchen yet
//   SENT     something's gone to the kitchen
//   LATE     a dish sent and not ready after its station's late time (the
//            kitchen display's rule — "Waiting long")
//   BILL     the bill's been printed
export type FloorStage = "SEATED" | "SENT" | "LATE" | "BILL";

export type FloorOrder = {
  id: string;
  ref: string;
  // A training order (Part 6f Step 7f): tagged TRAINING.
  training: boolean;
  // A separate check at a shared table: "Ada", "Check 2" (null: the
  // table's only, unnamed first check).
  check: string | null;
  stage: FloorStage;
  waiterId: string | null;
  // "Ada Okafor" (the card shows "AO").
  waiterName: string | null;
  // Minutes since it was opened.
  minutes: number;
  // Sent with Move / Merge (the order's version check).
  version: number;
  warehouseId: string;
  waiter: string | null;
  guests: number;
  // Formatted on the server from lib/pricing — the browser never totals.
  total: string;
  // "6m", "1h 12m".
  open: string;
  lines: { id: string; quantity: number; name: string; amount: string; kitchenStatus: KitchenStatus }[];
  // Dishes the kitchen has finished, waiting to be served (the card's dot).
  ready: number;
  // A guest's lines from the menu waiting for a waiter (Part 8 Step 7).
  pending: PendingGuestLine[];
};

export type FloorTable = {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  // Its first open check (Occupied) …
  order: FloorOrder | null;
  // … and every open check — guests sharing the table, each with their own
  // bill (separate checks). One for most tables.
  checks: FloorOrder[];
  // All its checks together ("₦48,200.00"; formatted here).
  checksTotal: string;
  // The booking that's due, if any.
  reservation: { id: string; guestName: string; partySize: number; time: string } | null;
  // Where it stands in its room, in metres from the top-left corner (the
  // floor plan editor's, Part 7): the service view draws it there.
  place: FloorPlace & { shape: TableShape };
};

export type FloorPlace = { x: number; y: number; w: number; h: number; rotation: number };
export type FloorFixtureView = FloorPlace & { id: string; type: FixtureType; label: string };

// Every active table (all areas), for the Move / Merge pickers — one per
// open check at a shared table (`key` tells them apart).
export type FloorTarget = {
  key: string;
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
  // Each with how many of its tables are free ("7/12 free").
  // layout: the event layout on its floor ("Wedding setup"), or null for
  // the everyday floor (Part 7 Step 5).
  areas: { id: string; name: string; layout: string | null; free: number; total: number }[];
  // All areas: free tables, open orders, guests at them, their value
  // (formatted here — the browser never totals).
  summary: { free: number; openOrders: number; guests: number; openValue: string };
  areaId: string | null;
  // Every active table, all areas.
  legend: Record<TableStatus, number>;
  // The selected area's tables, in floor order.
  tables: FloorTable[];
  // The selected area's room (metres) and its fixtures, for the service
  // view (Part 7 Step 6). Its floor plan image is never sent here.
  room: { widthM: number; heightM: number } | null;
  fixtures: FloorFixtureView[];
  // The area's floor plan has been saved in the editor (floorPlanSavedAt).
  // Not yet: its tables are drawn in a neat grid by number (lib/floorAuto,
  // 6g follow-up 3) — the editor starts from the same grid.
  planSaved: boolean;
  targets: FloorTarget[];
  // Guests' Call waiter / Request bill still to deal with (Part 8 Step 6),
  // every area's — the selected area's tables show a bell; the toasts
  // reach a waiter wherever they're looking.
  requests: FloorRequest[];
  // Guests' orders from the menu waiting for a waiter (Part 8 Step 7),
  // every area's.
  guestOrders: FloorGuestOrder[];
};

// The floor plan: every table's status from tableStatus (for the legend),
// and for the selected area (?area, else the first) the details each card
// and the side panel show. Deleted tables and areas never appear.
export async function getFloor(areaParam?: string): Promise<FloorData> {
  const now = new Date();
  const [rules, settings] = await Promise.all([getTableStatusRules(), getBusinessSettings()]);
  const [areas, tables, requestRows] = await Promise.all([
    prisma.diningArea.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, roomWidthM: true, roomHeightM: true, floorPlanSavedAt: true, layouts: { where: { isActive: true }, select: { name: true }, take: 1 } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.table.findMany({
      where: { deletedAt: null, area: { deletedAt: null } },
      select: {
        id: true,
        name: true,
        seats: true,
        areaId: true,
        x: true,
        y: true,
        w: true,
        h: true,
        rotation: true,
        shape: true,
        area: { select: { sortOrder: true, createdAt: true, name: true, warehouseId: true } },
        ...tableStateSelect(now, rules),
      },
    }),
    prisma.tableRequest.findMany({
      where: { ...activeRequestWhere(now), table: { deletedAt: null, area: { deletedAt: null } } },
      select: { id: true, tableId: true, type: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const areaId = areas.some((area) => area.id === areaParam) ? (areaParam ?? null) : (areas[0]?.id ?? null);
  const shown = areas.find((area) => area.id === areaId) ?? null;
  const fixtures = shown
    ? await prisma.floorFixture.findMany({ where: { areaId: shown.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, label: true, x: true, y: true, w: true, h: true, rotation: true } })
    : [];
  const metres = <T extends { x: unknown; y: unknown; w: unknown; h: unknown; rotation: number }>(row: T): FloorPlace => ({ x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h), rotation: row.rotation });

  const states = tables.flatMap((table) => {
    const state = tableStatus(table, rules, now);
    return state ? [{ table, state }] : [];
  });
  const areaCounts = (id: string) => {
    const mine = states.filter(({ table }) => table.areaId === id);
    return { free: mine.filter(({ state }) => state.status === "Available").length, total: mine.length };
  };
  const legend = Object.fromEntries(TABLE_STATUSES.map((status) => [status, 0])) as Record<TableStatus, number>;
  for (const { state } of states) legend[state.status]++;

  const sorted = [...states].sort((a, b) => byFloorOrder(a.table, b.table));
  const here = sorted.filter(({ table }) => table.areaId === areaId);
  const saved = !!shown && planSaved(shown.floorPlanSavedAt);
  const auto = shown && !saved ? autoFloor(here.map(({ table }) => ({ id: table.id, name: table.name, w: Number(table.w), h: Number(table.h) })), { widthM: Number(shown.roomWidthM), heightM: Number(shown.roomHeightM) }) : null;
  // Every occupied table's open checks (the pickers show their references).
  const orderIds = states.flatMap(({ state }) => state.orders.map((o) => o.id));
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
          billPrintedAt: true,
          training: true,
          waiterId: true,
          checkNumber: true,
          checkName: true,
          discountType: true,
          discountValue: true,
          serviceCharge: true,
          waiter: { select: { firstName: true, lastName: true } },
          guestLines: {
            where: { status: "PENDING" },
            select: { id: true, sendId: true, quantity: true, unitPrice: true, modifiers: true, note: true, createdAt: true, product: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
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
              sentAt: true,
              kitchenStation: { select: { lateAfterMin: true } },
              product: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : [];
  const byId = new Map(orders.map((order) => [order.id, order]));
  const totals = new Map(orders.map((order) => [order.id, orderTotals(order.items, settings.restaurantServiceChargePercent, order).total]));
  const stageOf = (order: (typeof orders)[number]): FloorStage => {
    if (order.billPrintedAt) return "BILL";
    const sent = order.items.filter((line) => line.kitchenStatus !== "NEW");
    if (sent.some((line) => (line.kitchenStatus === "PENDING" || line.kitchenStatus === "PREPARING") && line.sentAt && isLate(line.sentAt, line.kitchenStation?.lateAfterMin ?? DEFAULT_LATE_MIN, now))) return "LATE";
    return sent.length ? "SENT" : "SEATED";
  };

  const floorOrder = (order: (typeof orders)[number], checksHere: number): FloorOrder => {
    const label = withCheck("", order).replace(/^ · /, "");
    return {
      id: order.id,
      ref: orderRef(order.number),
      training: order.training,
      check: label || (checksHere > 1 ? `Check ${order.checkNumber ?? 1}` : null),
      stage: stageOf(order),
      waiterId: order.waiterId,
      waiterName: order.waiter ? `${order.waiter.firstName} ${order.waiter.lastName}`.trim() : null,
      minutes: Math.max(0, Math.floor((now.getTime() - order.openedAt.getTime()) / 60_000)),
      version: order.version,
      warehouseId: order.warehouseId,
      waiter: order.waiter?.firstName ?? null,
      guests: order.guests,
      // The ticket's Total (service charge and tax included).
      total: formatNaira(totals.get(order.id)!.toFixed(2)),
      open: formatOpenFor(Math.max(0, Math.floor((now.getTime() - order.openedAt.getTime()) / 60_000))),
      lines: order.items.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        name: line.product.name,
        amount: formatNaira(lineAmount(line).toFixed(2)),
        kitchenStatus: line.kitchenStatus,
      })),
      ready: order.items.filter((line) => line.kitchenStatus === "READY").reduce((sum, line) => sum + line.quantity, 0),
      pending: order.guestLines.map((g) => ({
        id: g.id,
        name: g.product.name,
        quantity: g.quantity,
        detail: lineDetail(readModifiers(g.modifiers), g.note),
        amount: formatNaira(g.unitPrice.times(g.quantity).toFixed(2)),
        time: formatAppTime(g.createdAt),
      })),
    };
  };

  const stateOf = new Map(states.map(({ table, state }) => [table.id, { table, state }]));
  const requests = requestRows.flatMap((r): FloorRequest[] => {
    const held = stateOf.get(r.tableId);
    if (!held || r.status === "DONE") return [];
    return [
      {
        id: r.id,
        tableId: r.tableId,
        tableName: held.table.name,
        areaId: held.table.areaId,
        areaName: held.table.area.name,
        type: r.type,
        status: r.status,
        minutes: Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / 60_000)),
        waiterIds: [...new Set(held.state.orders.flatMap((o) => byId.get(o.id)?.waiterId ?? []))],
      },
    ];
  });

  const guestOrders = states.flatMap(({ table, state }) =>
    state.orders.flatMap((held): FloorGuestOrder[] => {
      const order = byId.get(held.id);
      // A training order (Part 6f) never carries a guest's order.
      if (!order || order.training || order.guestLines.length === 0) return [];
      const first = order.guestLines[0];
      return [
        {
          orderId: order.id,
          tableId: table.id,
          tableName: table.name,
          areaId: table.areaId,
          areaName: table.area.name,
          label: null,
          lines: order.guestLines.length,
          sendId: order.guestLines[order.guestLines.length - 1].sendId,
          minutes: Math.max(0, Math.floor((now.getTime() - first.createdAt.getTime()) / 60_000)),
          waiterIds: order.waiterId ? [order.waiterId] : [],
        },
      ];
    }),
  );

  // QR points' takeaways and tabs (Step 8) with lines waiting: no table, so
  // they're found by their held lines.
  const counterRows = await prisma.order.findMany({
    where: { tableId: null, deletedAt: null, training: false, status: { in: ["OPEN", "SENT", "SERVED"] }, guestLines: { some: { status: "PENDING" } } },
    select: { id: true, type: true, tabName: true, waiterId: true, guestLines: { where: { status: "PENDING" }, select: { sendId: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "asc" },
    take: 40,
  });
  for (const order of counterRows) {
    guestOrders.push({
      orderId: order.id,
      tableId: null,
      tableName: "",
      areaId: null,
      areaName: "",
      label: noTableLabel(order.type, order.tabName),
      lines: order.guestLines.length,
      sendId: order.guestLines[order.guestLines.length - 1].sendId,
      minutes: Math.max(0, Math.floor((now.getTime() - order.guestLines[0].createdAt.getTime()) / 60_000)),
      waiterIds: order.waiterId ? [order.waiterId] : [],
    });
  }

  return {
    requests,
    guestOrders,
    areas: areas.map((area) => ({ id: area.id, name: area.name, layout: area.layouts[0]?.name ?? null, ...areaCounts(area.id) })),
    room: auto ? auto.room : shown ? { widthM: Number(shown.roomWidthM), heightM: Number(shown.roomHeightM) } : null,
    planSaved: saved,
    fixtures: fixtures.map((f) => ({ id: f.id, type: f.type, label: f.label, ...metres(f) })),
    summary: {
      free: legend.Available,
      openOrders: orders.length,
      guests: orders.reduce((sum, order) => sum + order.guests, 0),
      openValue: formatNaira([...totals.values()].reduce((sum, total) => sum.plus(total), new Decimal(0)).toFixed(2)),
    },
    areaId,
    legend,
    tables: here.map(({ table, state }) => {
      const checks = state.orders.flatMap((held) => {
        const order = byId.get(held.id);
        return order ? [floorOrder(order, state.orders.length)] : [];
      });
      return {
        id: table.id,
        name: table.name,
        seats: table.seats,
        status: state.status,
        // A shared table shows its most pressing check's colour.
        order: checks.length > 1 ? { ...checks[0], stage: worstStage(checks.map((c) => c.stage)) } : (checks[0] ?? null),
        checks,
        checksTotal: formatNaira(state.orders.reduce((sum, held) => sum.plus(totals.get(held.id) ?? 0), new Decimal(0)).toFixed(2)),
        reservation: state.reservation
          ? {
              id: state.reservation.id,
              guestName: state.reservation.guestName,
              partySize: state.reservation.partySize,
              time: formatAppTime(state.reservation.startsAt),
            }
          : null,
        place: { ...(auto?.places[table.id] ?? metres(table)), shape: table.shape },
      };
    }),
    targets: sorted.flatMap(({ table, state }) => (state.orders.length ? state.orders : [null]).map((held) => {
      const order = held ? byId.get(held.id) : undefined;
      return {
        key: order?.id ?? table.id,
        id: table.id,
        name: order && state.orders.length > 1 ? withCheck(table.name, order) : table.name,
        areaName: table.area.name,
        warehouseId: table.area.warehouseId,
        status: state.status,
        orderId: order?.id ?? null,
        orderRef: order ? orderRef(order.number) : null,
        booking: state.reservation ? `${state.reservation.guestName} · ${formatAppTime(state.reservation.startsAt)}` : null,
      };
    })),
  };
}
