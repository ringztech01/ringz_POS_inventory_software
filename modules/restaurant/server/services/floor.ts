import "server-only";
import { prisma } from "@/lib/db";
import type { ActionFailure, ActionResult } from "../../lib/actionResult";
import { tableStatus } from "../../lib/tableStatus";
import { formatAppTime } from "../../lib/time";
import { lockTable } from "../locks";
import { isUniqueViolation } from "../prismaErrors";
import { tableStateSelect } from "../queries/tables";
import { getTableStatusRules } from "../rules";

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
// warehouse. The table is locked and tableStatus decides whether it's free;
// the one-open-order-per-table index backs that up.
export async function openTableOrder(tableId: string, waiterId: string): Promise<OpenOrderResult> {
  const rules = await getTableStatusRules();
  try {
    return await prisma.$transaction(async (tx): Promise<OpenOrderResult> => {
      if (!(await lockTable(tx, tableId))) return { ok: false, error: TABLE_GONE };
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
        data: { type: "DINE_IN", status: "OPEN", tableId, warehouseId: table.area.warehouseId, waiterId },
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

// An Open takeaway order (no table), stocked from the area's warehouse.
export async function createTakeawayOrder(areaId: string, waiterId: string): Promise<OpenOrderResult> {
  const area = await prisma.diningArea.findFirst({
    where: { id: areaId, deletedAt: null, warehouse: { deletedAt: null } },
    select: { warehouseId: true },
  });
  if (!area) return { ok: false, error: "That area is no longer available. Refresh and try again." };

  const order = await prisma.$transaction((tx) =>
    tx.order.create({
      data: { type: "TAKEAWAY", status: "OPEN", tableId: null, warehouseId: area.warehouseId, waiterId },
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
