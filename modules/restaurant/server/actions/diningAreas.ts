"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { diningAreaSchema, type DiningAreaField } from "../../schemas/diningArea";
import { requirePermission } from "../guard";
import { lockArea, lockWarehouse } from "../locks";
import { safely } from "../safely";

type AreaResult = ActionResult<DiningAreaField>;

const NOT_FOUND = "Dining area not found. It may have been deleted.";
const HAS_TABLES = "Move or delete its tables first.";
const duplicate = () => invalid<DiningAreaField>({ name: ["An area with this name already exists in this warehouse."] });
const inactiveWarehouse = () => invalid<DiningAreaField>({ warehouseId: ["Choose an active warehouse."] });

// Row locks (server/locks.ts) serialise writes that check before they write:
// two saves can't both pass the name check, and an area can't be deleted
// while a table is being added to it.

// Another active area with this name in the warehouse? The collation makes
// it case-insensitive ("Patio" = "patio").
async function nameTaken(tx: Prisma.TransactionClient, name: string, warehouseId: string, exceptId?: string) {
  const clash = await tx.diningArea.findFirst({
    where: { name, warehouseId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return !!clash;
}

const requireManageTables = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_TABLES);
const refresh = () => revalidatePath("/restaurant", "layout");

export async function createDiningArea(input: unknown): Promise<AreaResult> {
  return safely("create dining area", async (): Promise<AreaResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };

    const parsed = diningAreaSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const { name, warehouseId } = parsed.data;

    const result = await prisma.$transaction(async (tx): Promise<AreaResult> => {
      if (!(await lockWarehouse(tx, warehouseId))) return inactiveWarehouse();
      if (await nameTaken(tx, name, warehouseId)) return duplicate();
      // New areas go last on the floor plan's tabs.
      const last = await tx.diningArea.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
      await tx.diningArea.create({ data: { name, warehouseId, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}

export async function updateDiningArea(rawId: unknown, input: unknown): Promise<AreaResult> {
  return safely("update dining area", async (): Promise<AreaResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    const parsed = diningAreaSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const { name, warehouseId } = parsed.data;

    const result = await prisma.$transaction(async (tx): Promise<AreaResult> => {
      const area = await lockArea(tx, id);
      if (!area) return { ok: false, error: NOT_FOUND };

      if (area.warehouseId !== warehouseId) {
        // Open orders were started against the old warehouse's stock.
        const open = await tx.order.count({ where: { activeTableId: { not: null }, table: { areaId: id } } });
        if (open > 0) {
          return invalid<DiningAreaField>({
            warehouseId: ["Its tables have open orders. Close them before moving the area to another warehouse."],
          });
        }
      }

      if (!(await lockWarehouse(tx, warehouseId))) return inactiveWarehouse();
      if (await nameTaken(tx, name, warehouseId, id)) return duplicate();
      await tx.diningArea.update({ where: { id }, data: { name, warehouseId } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}

// Soft delete, refused while the area still has active tables.
export async function deleteDiningArea(rawId: unknown): Promise<AreaResult> {
  return safely("delete dining area", async (): Promise<AreaResult> => {
    const authCheck = await requireManageTables();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    const result = await prisma.$transaction(async (tx): Promise<AreaResult> => {
      if (!(await lockArea(tx, id))) return { ok: false, error: NOT_FOUND };
      const tables = await tx.table.count({ where: { areaId: id, deletedAt: null } });
      if (tables > 0) return { ok: false, error: HAS_TABLES };
      await tx.diningArea.update({ where: { id }, data: { deletedAt: new Date() } });
      return { ok: true };
    });

    if (result.ok) refresh();
    return result;
  });
}
