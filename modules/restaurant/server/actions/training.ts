"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "../../lib/actionResult";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import { setTrainingMode as setTrainingModeService } from "../services/training";

// Settings › Staff (Part 6f Step 7f): training mode. The Administrator's
// alone. Never throws.
export async function setTrainingMode(input: unknown): Promise<ActionResult> {
  return safely("set training mode", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const { id, on } = (input ?? {}) as { id?: unknown; on?: unknown };
    if (typeof id !== "string" || !id || typeof on !== "boolean") return { ok: false, error: "That person isn't known." };
    const result = await setTrainingModeService({ id, on }, admin.userId);
    if (result.ok) revalidatePath("/settings/restaurant/staff");
    return result;
  });
}
