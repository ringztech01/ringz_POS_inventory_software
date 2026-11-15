"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { reportSettingsSchema } from "../../schemas/reports";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { setReportSettings } from "../services/reportSettings";

// Restaurant › Touch POS › Reports: when Restaurant Reports' day starts, and
// the cash variance limit. Needs Restaurant Settings.
export async function saveReportSettings(input: unknown): Promise<ActionResult> {
  return safely("save report settings", async (): Promise<ActionResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = reportSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Those settings can't be saved." };
    await setReportSettings(parsed.data);
    revalidatePath("/restaurant/settings/pos");
    revalidatePath("/restaurant/reports", "layout");
    return { ok: true };
  });
}
