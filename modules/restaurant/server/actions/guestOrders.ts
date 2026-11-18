"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionFailure } from "../../lib/actionResult";
import { GUEST_MAX_LINES_LIMIT } from "../../lib/guestOrdering";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requireMenuQr, requirePermission } from "../guard";
import { safely } from "../safely";
import { confirmGuestLines, rejectGuestLines, saveGuestOrderingSettings, setGuestOrderingPaused } from "../services/guestOrders";
import type { OrderChangeResult } from "../services/orders";

// Guest ordering (Part 8 Step 7). Confirming or rejecting a guest's lines
// needs Manage Orders; its settings and the pause switch are for whoever
// looks after the menu (the Administrator or Manage Floor Plan).

const requireManageOrders = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos", "layout");
};
const BAD = "Something in that wasn't right. Please try again.";

const linesSchema = z.array(idSchema).min(1).max(100);
const confirmSchema = z.object({ orderId: idSchema, version: z.number().int().min(0), lineIds: linesSchema });
const rejectSchema = z.object({ orderId: idSchema, lineIds: linesSchema });

export async function confirmGuestLinesAction(input: unknown): Promise<OrderChangeResult> {
  return safely("confirm guest lines", async (): Promise<OrderChangeResult> => {
    const auth = await requireManageOrders();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: BAD };
    const result = await confirmGuestLines(parsed.data.orderId, parsed.data.version, parsed.data.lineIds, auth.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function rejectGuestLinesAction(input: unknown): Promise<{ ok: true } | ActionFailure> {
  return safely("reject guest lines", async (): Promise<{ ok: true } | ActionFailure> => {
    const auth = await requireManageOrders();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = rejectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: BAD };
    const result = await rejectGuestLines(parsed.data.orderId, parsed.data.lineIds, auth.userId);
    if (result.ok) refresh();
    return result;
  });
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  requireWaiterConfirm: z.boolean(),
  autoSend: z.boolean(),
  maxLines: z.number().int().min(1, "At least 1 line.").max(GUEST_MAX_LINES_LIMIT, `At most ${GUEST_MAX_LINES_LIMIT} lines.`),
  // "" or null: no value cap.
  maxValue: z
    .union([z.string().trim(), z.null()])
    .transform((v) => (v === null || v === "" ? null : v.replace(/,/g, "")))
    .refine((v) => v === null || (/^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0), "The value cap is an amount in Naira, more than 0 (or leave it empty for none)."),
});

export async function saveGuestOrderingAction(input: unknown): Promise<{ ok: true } | ActionFailure> {
  return safely("save guest ordering", async (): Promise<{ ok: true } | ActionFailure> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? BAD };
    const result = await saveGuestOrderingSettings(parsed.data, auth.userId);
    revalidatePath("/restaurant/digital-menu/qr-codes");
    refresh();
    return result;
  });
}

export async function pauseGuestOrderingAction(paused: unknown): Promise<{ ok: true } | ActionFailure> {
  return safely("pause guest ordering", async (): Promise<{ ok: true } | ActionFailure> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    if (typeof paused !== "boolean") return { ok: false, error: BAD };
    await setGuestOrderingPaused(paused, auth.userId);
    refresh();
    return { ok: true };
  });
}
