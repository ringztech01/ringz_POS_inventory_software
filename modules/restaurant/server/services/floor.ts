import "server-only";
import { trainingOf } from "./orders";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import type { ActionFailure, ActionResult } from "../../lib/actionResult";
import { tableStatus } from "../../lib/tableStatus";
import { formatAppTime } from "../../lib/time";
import { heldOrders, lockTable, tableTransaction } from "../locks";
import { isUniqueViolation } from "../prismaErrors";
import { tableStateSelect } from "../queries/tables";
import { getTableStatusRules } from "../rules";
import type { NewPosOrderInput } from "../../schemas/pos";

// The rules behind Open table, New takeaway and Mark clean, without the
// permission check and input parsing (the server actions in
// ../actions/floor.ts do those). Kept apart so the concurrency tests can run
// them against a database.

// Open table / New takeaway land on the order; a table that's already busy
// sends its existing order back so the screen can open that instead.
export type OpenOrderResult = { ok: true; orderId: string } | (ActionFailure & { orderId?: string });

export const ALREADY_OPEN = "This table already has an open order";
export const TABLE_GONE = "Table not found. It may have been deleted.";

// A new Open, Dine-in order on the table — `waiterId` as waiter, the area's
// warehouse, `guests` at it (the POS tables screen asks; otherwise the
// default). The table is locked and tableStatus decides whether it's free;
// the one-open-order-per-table index backs that up.
export async function openTableOrder(tableId: string, waiterId: string, guests?: number): Promise<OpenOrderResult> {
  const rules = await getTableStatusRules();
  try {
    return await tableTransaction(async (tx): Promise<OpenOrderResult> => {
      if (!(await lockTable(tx, tableId))) return { ok: false, error: TABLE_GONE };
      const held = await heldOrders(tx, tableId);
      if (held.length) return { ok: false, error: ALREADY_OPEN, orderId: held[0].id };
      const now = new Date();
      const table = await tx.table.findUniqueOrThrow({
        where: { id: tableId },
        select: { name: true, area: { select: { warehouseId: true, deletedAt: true } }, ...tableStateSelect(now, rules) },
      });
      if (table.area.deletedAt) return { ok: false, error: TABLE_GONE };

      const state = tableStatus(table, rules, now);
      if (state?.status === "Occupied") return { ok: false, error: ALREADY_OPEN, orderId: state.order?.id };
      if (state?.status === "Cleaning") return { ok: false, error: `${table.name} still needs cleaning. Mark it clean first.` };
      if (state?.status === "Reserved" && state.reservation) {
        return {
          ok: false,
          error: `${table.name} is reserved for ${state.reservation.guestName} at ${formatAppTime(state.reservation.startsAt)}. Seat the booking instead.`,
        };
      }

      const order = await tx.order.create({
        data: { type: "DINE_IN", status: "OPEN", tableId, warehouseId: table.area.warehouseId, waiterId, checkNumber: 1, ...(guests ? { guests } : {}), training: await trainingOf(tx, waiterId) },
        select: { id: true },
      });
      return { ok: true, orderId: order.id };
    });
  } catch (error) {
    if (isUniqueViolation(error, "activeTableId")) {
      const existing = await prisma.order.findFirst({ where: { tableId, activeTableId: { not: null } }, select: { id: true } });
      return { ok: false, error: ALREADY_OPEN, orderId: existing?.id };
    }
    throw error;
  }
}

// New check: another guest at a shared table gets their own order there —
// their own bill, payment and receipt (separate checks). On a table with
// open checks it's the next number; on a free one it's simply the first
// (as Open table). `name`: the guest's, for the check ("Ada"). The table is
// locked while it's decided, so two tills can't take the same number.
export async function openTableCheck(tableId: string, waiterId: string, guests: number, name: string | null): Promise<OpenOrderResult> {
  const rules = await getTableStatusRules();
  return tableTransaction(async (tx): Promise<OpenOrderResult> => {
    if (!(await lockTable(tx, tableId))) return { ok: false, error: TABLE_GONE };
    const held = await heldOrders(tx, tableId);
    const now = new Date();
    const table = await tx.table.findUniqueOrThrow({
      where: { id: tableId },
      select: { name: true, area: { select: { warehouseId: true, deletedAt: true } }, ...tableStateSelect(now, rules) },
    });
    if (table.area.deletedAt) return { ok: false, error: TABLE_GONE };
    const state = tableStatus(table, rules, now);
    if (!held.length && state?.status === "Cleaning") return { ok: false, error: `${table.name} still needs cleaning. Mark it clean first.` };
    if (!held.length && state?.status === "Reserved" && state.reservation) {
      return { ok: false, error: `${table.name} is reserved for ${state.reservation.guestName} at ${formatAppTime(state.reservation.startsAt)}. Seat the booking instead.` };
    }
    const taken = held.map((o) => o.checkNumber ?? 1);
    const order = await tx.order.create({
      data: { type: "DINE_IN", status: "OPEN", tableId, warehouseId: table.area.warehouseId, waiterId, guests, checkNumber: taken.length ? Math.max(...taken) + 1 : 1, checkName: name, training: await trainingOf(tx, waiterId) },
      select: { id: true },
    });
    return { ok: true, orderId: order.id };
  });
}

// An Open takeaway order (no table), stocked from the area's warehouse.
export async function createTakeawayOrder(areaId: string, waiterId: string): Promise<OpenOrderResult> {
  const area = await prisma.diningArea.findFirst({
    where: { id: areaId, deletedAt: null, warehouse: { deletedAt: null } },
    select: { warehouseId: true },
  });
  if (!area) return { ok: false, error: "That area is no longer available. Refresh and try again." };

  const training = await trainingOf(prisma, waiterId);
  const order = await prisma.$transaction((tx) =>
    tx.order.create({
      data: { type: "TAKEAWAY", status: "OPEN", tableId: null, warehouseId: area.warehouseId, waiterId, training },
      select: { id: true },
    }),
  );
  return { ok: true, orderId: order.id };
}

// A Cleaning table becomes free again.
export async function markTableCleaned(tableId: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    if (!(await lockTable(tx, tableId))) return { ok: false, error: TABLE_GONE };
    await tx.table.update({ where: { id: tableId }, data: { needsCleaning: false } });
    return { ok: true };
  });
}

// The touch POS's Takeaway and Bar tab (Part 6e): an Open order with no
// table — a bar tab with its name — stocked from the restaurant's warehouse
// (Settings), else the first dining area's.
export async function createCounterOrder(input: NewPosOrderInput, waiterId: string): Promise<OpenOrderResult> {
  const settings = await getBusinessSettings();
  const own = settings.restaurantWarehouseId
    ? await prisma.warehouse.findFirst({ where: { id: settings.restaurantWarehouseId, deletedAt: null }, select: { id: true } })
    : null;
  const warehouseId =
    own?.id ??
    (await prisma.diningArea.findFirst({ where: { deletedAt: null, warehouse: { deletedAt: null } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { warehouseId: true } }))?.warehouseId;
  if (!warehouseId) return { ok: false, error: "Add a dining area (with its warehouse) first." };
  const order = await prisma.order.create({
    data: { type: input.type, status: "OPEN", tableId: null, warehouseId, waiterId, tabName: input.type === "BAR_TAB" ? input.tabName : null, training: await trainingOf(prisma, waiterId) },
    select: { id: true },
  });
  return { ok: true, orderId: order.id };
}

// An order opened by mistake and left with nothing on it (a table tapped,
// then Tables): it's thrown away (soft-deleted) so the table is free again
// (Order.activeTableId lets go). Only when it's still Open with no lines at
// all (lines taken off don't count), no kitchen tickets, no bill parts and
// no sale — and not a bar tab (they're opened by name before ordering).
// Anything else is left as it is. Returns whether it was thrown away.
export async function discardEmptyOrder(orderId: string): Promise<{ ok: true; discarded: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, type: true, deletedAt: true, saleId: true, _count: { select: { items: { where: { deletedAt: null } }, kots: true, billParts: true } } },
    });
    const empty =
      !!order && !order.deletedAt && order.status === "OPEN" && order.type !== "BAR_TAB" && !order.saleId && order._count.items === 0 && order._count.kots === 0 && order._count.billParts === 0;
    if (!empty) return { ok: true as const, discarded: false };
    const now = new Date();
    await tx.order.update({ where: { id: orderId }, data: { deletedAt: now, closedAt: now, version: { increment: 1 } } });
    return { ok: true as const, discarded: true };
  });
}
