import "server-only";
import type { KitchenStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orderRef } from "../../lib/format";
import { kotRef, type KdsView } from "../../lib/kds";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";

// The kitchen display's data: active stations and the tickets for the view.
//   Active: NEW tickets not bumped yet, oldest first, up to 60.
//   Recently done: bumped in the last 6 hours, newest first, up to 30.
// A ticket shows its live lines (not cancelled or removed); one with none
// left is hidden. Its table, order and waiter come from its lines' current
// order — after a move or merge that's where the food goes.

const ACTIVE_LIMIT = 60;
const DONE_LIMIT = 30;
const DONE_WINDOW_MS = 6 * 60 * 60 * 1000;

export type KdsLine = {
  itemId: string;
  // The dish (Remake's cost preview).
  productId: string;
  name: string;
  quantity: number;
  modifiers: string | null;
  note: string | null;
  status: KitchenStatus;
  // A remake line (made again at no charge).
  remake: boolean;
};

export type KdsTicket = {
  id: string;
  ref: string;
  // Table name, or the order type for an order with no table ("Takeaway").
  table: string;
  type: string;
  station: { code: string; name: string; lateAfterMin: number };
  orderRef: string;
  waiter: string;
  sentAt: string;
  bumpedAt: string | null;
  printCount: number;
  // The ticket's note: "REMAKE: Burnt" on a remake's ticket.
  note: string | null;
  lines: KdsLine[];
  cancelledCount: number;
};

export type KitchenBoardData = {
  stations: { code: string; name: string }[];
  station: string | null;
  view: KdsView;
  tickets: KdsTicket[];
  // Every active ticket for the station filter (the header's counts).
  active: { id: string; sentAt: string; lateAfterMin: number }[];
  serverNow: string;
};

const orderInfo = {
  select: { number: true, type: true, table: { select: { name: true } }, waiter: { select: { firstName: true } } },
} satisfies Prisma.OrderDefaultArgs;

const ticketSelect = {
  id: true,
  number: true,
  createdAt: true,
  bumpedAt: true,
  printCount: true,
  note: true,
  station: { select: { code: true, name: true, lateAfterMin: true } },
  order: orderInfo,
  lines: {
    orderBy: { id: "asc" },
    select: {
      name: true,
      quantity: true,
      modifiers: true,
      note: true,
      orderItem: { select: { id: true, productId: true, remakeOfId: true, kitchenStatus: true, cancelledAt: true, deletedAt: true, order: { select: { ...orderInfo.select, deletedAt: true } } } },
    },
  },
} satisfies Prisma.KotSelect;

type TicketRow = Prisma.KotGetPayload<{ select: typeof ticketSelect }>;

function toTicket(kot: TicketRow): KdsTicket | null {
  const live = kot.lines.filter((line) => !line.orderItem.cancelledAt && !line.orderItem.deletedAt && !line.orderItem.order.deletedAt);
  if (live.length === 0) return null;
  const order = live[0].orderItem.order;
  return {
    id: kot.id,
    ref: kotRef(kot.number),
    table: order.table?.name ?? ORDER_TYPE_LABEL[order.type],
    type: ORDER_TYPE_LABEL[order.type],
    station: kot.station,
    orderRef: orderRef(order.number),
    waiter: order.waiter?.firstName ?? "No waiter",
    sentAt: kot.createdAt.toISOString(),
    bumpedAt: kot.bumpedAt?.toISOString() ?? null,
    printCount: kot.printCount,
    note: kot.note,
    lines: live.map((line) => ({
      itemId: line.orderItem.id,
      productId: line.orderItem.productId,
      remake: !!line.orderItem.remakeOfId,
      name: line.name,
      quantity: line.quantity,
      modifiers: line.modifiers,
      note: line.note,
      status: line.orderItem.kitchenStatus,
    })),
    cancelledCount: kot.lines.length - live.length,
  };
}

export async function getKitchenStations() {
  return prisma.kitchenStation.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { code: true, name: true },
  });
}

export async function getKitchenBoard(filter: { station: string | null; view: KdsView }, now: Date = new Date()): Promise<Omit<KitchenBoardData, "stations">> {
  const forStation: Prisma.KotWhereInput = { type: "NEW", ...(filter.station ? { station: { code: filter.station } } : {}) };
  const [activeRows, doneRows] = await Promise.all([
    prisma.kot.findMany({ where: { ...forStation, bumpedAt: null }, orderBy: [{ createdAt: "asc" }, { number: "asc" }], take: ACTIVE_LIMIT, select: ticketSelect }),
    filter.view === "done"
      ? prisma.kot.findMany({
          where: { ...forStation, bumpedAt: { gte: new Date(now.getTime() - DONE_WINDOW_MS) } },
          orderBy: [{ bumpedAt: "desc" }, { number: "desc" }],
          take: DONE_LIMIT,
          select: ticketSelect,
        })
      : Promise.resolve([]),
  ]);
  const active = activeRows.map(toTicket).filter((t): t is KdsTicket => t !== null);
  const tickets = filter.view === "done" ? doneRows.map(toTicket).filter((t): t is KdsTicket => t !== null) : active;
  return {
    station: filter.station,
    view: filter.view,
    tickets,
    active: active.map((t) => ({ id: t.id, sentAt: t.sentAt, lateAfterMin: t.station.lateAfterMin })),
    serverNow: now.toISOString(),
  };
}

// ---- The printed ticket (/restaurant/kot/[id]) --------------------------------

export type KotForPrint = {
  id: string;
  ref: string;
  type: "NEW" | "VOID";
  note: string | null;
  station: string;
  table: string;
  orderRef: string;
  orderType: string;
  area: string | null;
  guests: number;
  waiter: string;
  createdAt: Date;
  printCount: number;
  lines: { quantity: number; name: string; modifiers: string | null; note: string | null }[];
  items: number;
};

// Everything the 80mm ticket shows. Like the board, the table and order come
// from its lines' current order (after a move or merge, where the food goes).
export async function getKotForPrint(id: string): Promise<KotForPrint | null> {
  const kot = await prisma.kot.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      type: true,
      note: true,
      createdAt: true,
      printCount: true,
      station: { select: { name: true } },
      order: { select: { id: true } },
      lines: {
        orderBy: { id: "asc" },
        select: { name: true, quantity: true, modifiers: true, note: true, orderItem: { select: { orderId: true } } },
      },
    },
  });
  if (!kot) return null;
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: kot.lines[0]?.orderItem.orderId ?? kot.order.id },
    select: {
      number: true,
      type: true,
      guests: true,
      table: { select: { name: true, area: { select: { name: true } } } },
      waiter: { select: { firstName: true } },
    },
  });
  return {
    id: kot.id,
    ref: kotRef(kot.number),
    type: kot.type,
    note: kot.note,
    station: kot.station.name,
    table: order.table?.name ?? ORDER_TYPE_LABEL[order.type],
    orderRef: orderRef(order.number),
    orderType: ORDER_TYPE_LABEL[order.type],
    area: order.table?.area.name ?? null,
    guests: order.guests,
    waiter: order.waiter?.firstName ?? "No waiter",
    createdAt: kot.createdAt,
    printCount: kot.printCount,
    lines: kot.lines.map(({ name, quantity, modifiers, note }) => ({ name, quantity, modifiers, note })),
    items: kot.lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}
