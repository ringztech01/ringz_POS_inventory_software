"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { newQrToken } from "../../lib/qrToken";
import { RESERVATION_GRACE_MINUTES } from "../../lib/tableStatus";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { tableSchema, type TableField } from "../../schemas/table";
import { requirePermission } from "../guard";
import { lockArea, lockTable } from "../locks";
import { safely } from "../safely";
import { replaceQrToken } from "../services/tables";

type TableResult = ActionResult<TableField>;

const NOT_FOUND = "Table not found. It may have been deleted.";
const duplicate = () => invalid<TableField>({ name: ["A table with this name already exists in this area."] });
const inactiveArea = () => invalid<TableField>({ areaId: ["Choose an active dining area."] });

const requireManageTables = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_TABLES);
const refresh = () => revalidatePath("/restaurant", "layout");

// Another active table with this name in the area? Case-insensitive (the
// collation), so "t4" clashes with "T4".
async function nameTaken(tx: Prisma.TransactionClient, name: string, areaId: string, exceptId?: string) {
  const clash = await tx.table.findFirst({
    where: { name, areaId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return !!clash;
}

// An Open / Sent / Served order on the table — the rows Order.activeTableId
// (the DB's one-per-table rule) marks.
async function hasOpenOrder(tx: Prisma.TransactionClient, tableId: string) {
  return (await tx.order.count({ where: { tableId, activeTableId: { not: null } } })) > 0;
}

// Row locks (server/locks.ts): the area while a table is added to it (so it
// can't be deleted meanwhile), the table while it's changed or deleted.

export async function createTable(input: unknown): Promise<TableResult> {
  return safely("create table", async (): Promise<TableResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };

    const parsed = tableSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const { name, seats, areaId } = parsed.data;

    const result = await prisma.$transaction(async (tx): Promise<TableResult> => {
      if (!(await lockArea(tx, areaId))) return inactiveArea();
      if (await nameTaken(tx, name, areaId)) return duplicate();
      // The QR token is made here, never sent by the browser.
      await tx.table.create({ data: { name, seats, areaId, qrToken: newQrToken() } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}

export async function updateTable(rawId: unknown, input: unknown): Promise<TableResult> {
  return safely("update table", async (): Promise<TableResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    const parsed = tableSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const { name, seats, areaId } = parsed.data;

    const result = await prisma.$transaction(async (tx): Promise<TableResult> => {
      const table = await lockTable(tx, id);
      if (!table) return { ok: false, error: NOT_FOUND };
      // Its open order belongs to the current area's warehouse.
      if (table.areaId !== areaId && (await hasOpenOrder(tx, id))) {
        return invalid<TableField>({ areaId: ["It has an open order. Close it before moving the table to another area."] });
      }
      if (!(await lockArea(tx, areaId))) return inactiveArea();
      if (await nameTaken(tx, name, areaId, id)) return duplicate();
      await tx.table.update({ where: { id }, data: { name, seats, areaId } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}

// Soft delete. Refused while it has an open order (the list disables the
// button too) or a booking still to come, which would otherwise vanish from
// the reservations list.
export async function deleteTable(rawId: unknown): Promise<TableResult> {
  return safely("delete table", async (): Promise<TableResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    const result = await prisma.$transaction(async (tx): Promise<TableResult> => {
      const table = await lockTable(tx, id);
      if (!table) return { ok: false, error: NOT_FOUND };
      if (await hasOpenOrder(tx, id)) {
        return { ok: false, error: `${table.name} has an open order, so it can't be deleted. Close the order first.` };
      }
      const bookings = await tx.reservation.count({
        where: {
          tableId: id,
          status: "BOOKED",
          deletedAt: null,
          startsAt: { gte: new Date(Date.now() - RESERVATION_GRACE_MINUTES * 60_000) },
        },
      });
      if (bookings > 0) {
        return { ok: false, error: `${table.name} has upcoming bookings. Move or cancel them first.` };
      }
      await tx.table.update({ where: { id }, data: { deletedAt: new Date() } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}

// A new QR token: the old printed code's link stops working at once.
export async function regenerateTableQr(rawId: unknown): Promise<TableResult> {
  return safely("regenerate table QR", async (): Promise<TableResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    if (!(await replaceQrToken(id))) return { ok: false, error: NOT_FOUND };

    refresh();
    return { ok: true };
  });
}
