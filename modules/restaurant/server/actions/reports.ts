"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { printZReport } from "../services/till";

export type ReprintAnswer = { ok: true; printer: string } | { ok: false; error: string };

// Restaurant Reports › Shifts & cash-up: a closed cash-up's Z-report again,
// through the print queue (Part 6d) to that till's receipt printer, marked
// REPRINT. Needs Restaurant Reports.
export async function reprintZReport(sessionId: unknown): Promise<ReprintAnswer> {
  return safely("reprint Z-report", async (): Promise<ReprintAnswer> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_REPORTS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = idSchema.safeParse(sessionId);
    if (!parsed.success) return { ok: false, error: "That cash-up can't be found." };
    const session = await prisma.tillSession.findFirst({ where: { id: parsed.data, closedAt: { not: null } }, select: { id: true, deviceId: true } });
    if (!session) return { ok: false, error: "That cash-up isn't closed yet, so it has no Z-report." };
    const printed = await printZReport({ deviceId: session.deviceId, sessionId: session.id }, authCheck.userId);
    if (!printed.ok) return printed;
    revalidatePath("/restaurant/reports/shifts");
    return { ok: true, printer: printed.printer };
  });
}
