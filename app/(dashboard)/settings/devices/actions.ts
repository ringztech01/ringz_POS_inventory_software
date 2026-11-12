"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/permissions.server";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";

// Settings › Devices: a device's name (shown on Settings › Printers too).
// Needs Manage Setting. Never throws.

const renameSchema = z.object({ id: z.string().regex(/^[0-9a-f-]{36}$/), name: z.string().trim().max(80, "A device name is at most 80 characters.") });

export async function renameDevice(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const check = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    if (check.error !== undefined) return { ok: false, error: check.error };
    const parsed = renameSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That device isn't known." };
    const name = parsed.data.name || null;
    const before = await prisma.device.findUnique({ where: { id: parsed.data.id }, select: { name: true } });
    if (!before) return { ok: false, error: "That device is no longer listed — refreshed." };
    await prisma.device.update({ where: { id: parsed.data.id }, data: { name } });
    if (before.name !== name) await writeAudit({ userId: check.userId, action: "device.rename", entityType: "Device", entityId: parsed.data.id, meta: { from: before.name, to: name } });
    revalidatePath("/settings/devices");
    revalidatePath("/settings/printers");
    return { ok: true };
  } catch (error) {
    console.error("[devices] rename failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
