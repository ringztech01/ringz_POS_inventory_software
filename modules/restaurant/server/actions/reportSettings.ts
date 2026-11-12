"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { dayStartSchema } from "../../schemas/reports";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { setDayStartMinutes } from "../services/reportSettings";

// Restaurant › Touch POS › Business day: when Restaurant Reports' day starts.
// Needs Restaurant Settings.
export async function saveDayStart(input: unknown): Promise<ActionResult> {
  return safely("save day start", async (): Promise<ActionResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = dayStartSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That time can't be saved." };
    await setDayStartMinutes(parsed.data.minutes);
    revalidatePath("/restaurant/settings/pos");
    revalidatePath("/restaurant/reports", "layout");
    return { ok: true };
  });
}
