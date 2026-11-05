"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { stationSchema, type StationField } from "../../schemas/station";
import { requirePermission } from "../guard";
import { lockStation } from "../locks";
import { isUniqueViolation } from "../prismaErrors";
import { safely } from "../safely";
import { openLinesAt } from "../services/stations";

type StationResult = ActionResult<StationField>;

const NOT_FOUND = "Station not found. It may have been deleted.";
const codeTaken = () => invalid<StationField>({ code: ["Another station already uses this code."] });

const requireSettings = () => requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
// Stations show on the kitchen display, tickets and the settings page.
const refresh = () => revalidatePath("/restaurant", "layout");

async function codeClash(tx: Prisma.TransactionClient, code: string, exceptId?: string) {
  const clash = await tx.kitchenStation.findFirst({ where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return !!clash;
}

// The unique index on code is the last word if two saves race.
async function saving(body: () => Promise<StationResult>): Promise<StationResult> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error, "code")) return codeTaken();
    throw error;
  }
}

export async function createStation(input: unknown): Promise<StationResult> {
  return safely("create station", async (): Promise<StationResult> => {
    const authCheck = await requireSettings();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = stationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await saving(() =>
      prisma.$transaction(async (tx): Promise<StationResult> => {
        if (await codeClash(tx, parsed.data.code)) return codeTaken();
        await tx.kitchenStation.create({ data: parsed.data });
        return { ok: true };
      }),
    );
    if (result.ok) refresh();
    return result;
  });
}

export async function updateStation(rawId: unknown, input: unknown): Promise<StationResult> {
  return safely("update station", async (): Promise<StationResult> => {
    const authCheck = await requireSettings();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const parsed = stationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await saving(() =>
      prisma.$transaction(async (tx): Promise<StationResult> => {
        if (!(await lockStation(tx, parsedId.data))) return { ok: false, error: NOT_FOUND };
        if (await codeClash(tx, parsed.data.code, parsedId.data)) return codeTaken();
        await tx.kitchenStation.update({ where: { id: parsedId.data }, data: parsed.data });
        return { ok: true };
      }),
    );
    if (result.ok) refresh();
    return result;
  });
}

// Soft delete, refused while the station has lines in its kitchen. Its menu
// items go back to no station (so they're sent to the first active one),
// and its code is freed for a new station; its tickets keep pointing at it.
export async function deleteStation(rawId: unknown): Promise<StationResult> {
  return safely("delete station", async (): Promise<StationResult> => {
    const authCheck = await requireSettings();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: NOT_FOUND };
    const id = parsedId.data;

    const result = await prisma.$transaction(async (tx): Promise<StationResult> => {
      if (!(await lockStation(tx, id))) return { ok: false, error: NOT_FOUND };
      const open = await openLinesAt(tx, id);
      if (open > 0) {
        return { ok: false, error: `It has ${open} ${open === 1 ? "line" : "lines"} in its kitchen right now — delete it once they have been served or cancelled.` };
      }
      await tx.product.updateMany({ where: { stationId: id }, data: { stationId: null } });
      await tx.kitchenStation.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, code: `DELETED-${id}` } });
      return { ok: true };
    });
    if (result.ok) refresh();
    return result;
  });
}
