"use server";

import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@/lib/permissions";
import type { ActionResult } from "../../lib/actionResult";
import { deviceInterfaceSchema, interfaceSchema } from "../../schemas/interface";
import { requireCorePermission } from "../guard";
import { safely } from "../safely";
import { setDeviceInterface as setDeviceInterfaceService, setRestaurantInterface as setRestaurantInterfaceService } from "../services/interface";

// Part 6f Step 1. Both: the module on, signed in, Manage Setting (checked
// here on the server). The next screen load picks the change up; every
// layout is rendered again for it.

const refresh = () => revalidatePath("/", "layout");

export async function setRestaurantInterface(input: unknown): Promise<ActionResult> {
  return safely("set restaurant interface", async (): Promise<ActionResult> => {
    const authCheck = await requireCorePermission(PERMISSIONS.MANAGE_SETTING);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = interfaceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick Service or Classic." };
    const result = await setRestaurantInterfaceService(parsed.data.view, authCheck.userId);
    if (result.changed) refresh();
    return { ok: true };
  });
}

// view: SERVICE / CLASSIC for this device's own, or null to follow the business.
export async function setDeviceInterface(input: unknown): Promise<ActionResult> {
  return safely("set device interface", async (): Promise<ActionResult> => {
    const authCheck = await requireCorePermission(PERMISSIONS.MANAGE_SETTING);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = deviceInterfaceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That device isn't known." };
    const result = await setDeviceInterfaceService(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}
