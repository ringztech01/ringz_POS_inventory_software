"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { unitSchema } from "@/lib/validations/unit";
import { countActiveProductsInUnit } from "./queries";
import type { UnitActionState } from "./types";

// Permission check (lib/auth/permissions.server.ts): DB-backed, per request.
const requireManageUnits = () => requirePermission(PERMISSIONS.MANAGE_UNITS);

export async function createUnit(formData: FormData): Promise<UnitActionState> {
  const authCheck = await requireManageUnits();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = unitSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await prisma.unit.create({ data: { name: parsed.data.name } });

  revalidatePath("/units");

  return { ok: true };
}

export async function updateUnit(id: string, formData: FormData): Promise<UnitActionState> {
  const authCheck = await requireManageUnits();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.unit.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Unit not found." };
  }

  const parsed = unitSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await prisma.unit.update({ where: { id }, data: { name: parsed.data.name } });

  revalidatePath("/units");

  return { ok: true };
}

export async function deleteUnit(id: string): Promise<UnitActionState> {
  const authCheck = await requireManageUnits();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.unit.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Unit not found." };
  }

  const activeProductCount = await countActiveProductsInUnit(id);
  if (activeProductCount > 0) {
    return {
      ok: false,
      error: `Can't delete — ${activeProductCount} product${activeProductCount === 1 ? "" : "s"} use this unit. Reassign them first.`,
    };
  }

  await prisma.unit.update({ where: { id }, data: { deletedAt: new Date() } });

  revalidatePath("/units");

  return { ok: true };
}
