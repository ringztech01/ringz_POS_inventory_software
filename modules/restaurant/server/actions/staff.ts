"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import type { ActionResult } from "../../lib/actionResult";
import { restaurantModule } from "../../manifest";
import { createStaffSchema, disableStaffSchema, enableStaffSchema, ownPinSchema, setStaffPinSchema, staffSettingsSchema, updateStaffSchema } from "../../schemas/staff";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import * as staff from "../services/staff";

// Settings › Staff (Part 6f Step 3). Every one but "my own PIN" is the
// Administrator's alone — checked here on the server; a Manager calling one
// directly is refused. Never throws.

const refresh = () => {
  revalidatePath("/settings/restaurant/staff");
  revalidatePath("/peoples/users");
};
const firstIssue = (error: { issues: { message: string }[] }, fallback: string) => error.issues[0]?.message ?? fallback;

export async function createStaff(input: unknown): Promise<{ ok: true; id: string; pin: string | null } | { ok: false; error: string }> {
  return safely("create staff", async () => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false as const, error: admin.error };
    const parsed = createStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: firstIssue(parsed.error, "Check the details.") };
    const result = await staff.createStaff(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateStaff(input: unknown): Promise<ActionResult> {
  return safely("update staff", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = updateStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the details.") };
    const result = await staff.updateStaff(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

// Set or reset a PIN (typed twice, or generated — shown once). A reset ends
// every session the person has.
export async function setStaffPin(input: unknown): Promise<{ ok: true; pin: string | null; reset: boolean } | { ok: false; error: string }> {
  return safely("set staff PIN", async () => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false as const, error: admin.error };
    const parsed = setStaffPinSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: firstIssue(parsed.error, "Enter the PIN twice.") };
    const result = await staff.setStaffPin(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function disableStaff(input: unknown): Promise<staff.DisableResult> {
  return safely("disable staff", async (): Promise<staff.DisableResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = disableStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That person can't be found." };
    const result = await staff.disableStaff(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function enableStaff(input: unknown): Promise<ActionResult> {
  return safely("enable staff", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = enableStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That person can't be found." };
    const result = await staff.enableStaff(parsed.data.id, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function saveStaffSettings(input: unknown): Promise<ActionResult> {
  return safely("save staff settings", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = staffSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those settings can't be saved." };
    const result = await staff.saveStaffSettings(parsed.data, admin.userId);
    if (result.ok) refresh();
    return result;
  });
}

// My PIN (anyone signed in): only while the Administrator allows it, and
// with the current PIN.
export async function changeOwnPin(input: unknown): Promise<ActionResult> {
  return safely("change own PIN", async (): Promise<ActionResult> => {
    if (!(await isModuleEnabled(restaurantModule.id))) return { ok: false, error: "The Restaurant module is turned off." };
    const { userId } = await getCurrentUserPermissions();
    if (!userId) return { ok: false, error: "You must be signed in to do that." };
    const parsed = ownPinSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Enter your PIN and the new one twice.") };
    return staff.changeOwnPin(userId, parsed.data);
  });
}
