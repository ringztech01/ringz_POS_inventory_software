"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentDeviceId } from "@/lib/hardware/device";
import { parseCash } from "../../lib/cashUp";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { closeTill as closeTillService, openTill as openTillService, printZReport as printZReportService, type TillSummary } from "../services/till";

// Cash-up (Part 6f Step 7b): open this till with a float, close it with the
// cash counted, print its Z-report. Settle Bill, on the device itself (its
// cookie, never one the page names). Never throws.

const refresh = () => revalidatePath("/pos/cash-up");
type Answer<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function tillUser(): Promise<{ error: string } | { userId: string; deviceId: string }> {
  const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.SETTLE_BILL);
  if (authCheck.error !== undefined) return { error: authCheck.error };
  const deviceId = await currentDeviceId();
  if (!deviceId) return { error: "This device isn't registered yet. Reload the page and try again." };
  return { userId: authCheck.userId, deviceId };
}

export async function openTill(input: unknown): Promise<Answer<{ id: string }>> {
  return safely("open till", async (): Promise<Answer<{ id: string }>> => {
    const me = await tillUser();
    if ("error" in me) return { ok: false, error: me.error };
    const float = parseCash((input as { float?: unknown } | null)?.float);
    if (!float) return { ok: false, error: "Enter the float: the cash in the drawer to start with (₦0 or more)." };
    const result = await openTillService({ deviceId: me.deviceId, float }, me.userId);
    if (result.ok) refresh();
    return result;
  });
}

const closeSchema = z.object({ sessionId: z.string().min(1).max(191), counted: z.unknown(), note: z.string().trim().max(200).optional() });

export async function closeTill(input: unknown): Promise<Answer<{ summary: TillSummary }>> {
  return safely("close till", async (): Promise<Answer<{ summary: TillSummary }>> => {
    const me = await tillUser();
    if ("error" in me) return { ok: false, error: me.error };
    const parsed = closeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Count the cash, then close." };
    const counted = parseCash(parsed.data.counted);
    if (!counted) return { ok: false, error: "Enter the cash you counted in the drawer (₦0 or more)." };
    const result = await closeTillService({ deviceId: me.deviceId, sessionId: parsed.data.sessionId, counted, note: parsed.data.note || null }, me.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function printZReport(sessionId: unknown): Promise<Answer<{ printer: string; reprint: boolean }>> {
  return safely("print Z-report", async (): Promise<Answer<{ printer: string; reprint: boolean }>> => {
    const me = await tillUser();
    if ("error" in me) return { ok: false, error: me.error };
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 191) return { ok: false, error: "That cash-up isn't known." };
    const result = await printZReportService({ deviceId: me.deviceId, sessionId }, me.userId);
    if (result.ok) refresh();
    return result;
  });
}
