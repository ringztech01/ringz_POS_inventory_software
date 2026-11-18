"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requireMenuQr, requirePermission } from "../guard";
import { safely } from "../safely";
import { saveServiceButtons, tapTableRequest, type TapResult } from "../services/tableRequests";

// Service requests (Part 8 Step 6). A waiter's tap on a table's bell needs
// Manage Orders; switching the guest buttons on or off is for whoever looks
// after the menu's QR codes (the Administrator or Manage Floor Plan).

const tapSchema = z.object({ id: idSchema, seen: z.enum(["OPEN", "ACKNOWLEDGED"]) });

export async function tapTableRequestAction(input: unknown): Promise<TapResult> {
  return safely("tap table request", async (): Promise<TapResult> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = tapSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That request has already been dealt with." };
    return tapTableRequest(parsed.data.id, parsed.data.seen, auth.userId);
  });
}

const buttonsSchema = z.object({ callWaiter: z.boolean(), requestBill: z.boolean() });

export async function saveServiceButtonsAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return safely("save menu service buttons", async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = buttonsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Something in that wasn't right. Please try again." };
    const result = await saveServiceButtons(parsed.data, auth.userId);
    revalidatePath("/restaurant/digital-menu/qr-codes");
    return result;
  });
}
