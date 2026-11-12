"use server";

import { revalidatePath } from "next/cache";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import { removeStaffCard as removeStaffCardService, setStaffCard as setStaffCardService } from "../services/staffCard";

// Settings › Staff (Part 6f Step 7d): staff cards. The Administrator's
// alone. Never throws.

type Answer = { ok: true; label: string | null } | { ok: false; error: string };

export async function setStaffCard(input: unknown): Promise<Answer> {
  return safely("set staff card", async (): Promise<Answer> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const { id, code } = (input ?? {}) as { id?: unknown; code?: unknown };
    if (typeof id !== "string" || !id || typeof code !== "string") return { ok: false, error: "Hold the card to the reader, or type its number." };
    const result = await setStaffCardService({ id, code }, admin.userId);
    if (result.ok) revalidatePath("/settings/restaurant/staff");
    return result;
  });
}

export async function removeStaffCard(id: unknown): Promise<Answer> {
  return safely("remove staff card", async (): Promise<Answer> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    if (typeof id !== "string" || !id) return { ok: false, error: "That person isn't known." };
    const result = await removeStaffCardService(id, admin.userId);
    if (result.ok) revalidatePath("/settings/restaurant/staff");
    return result;
  });
}
