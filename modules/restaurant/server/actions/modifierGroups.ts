"use server";

import { revalidatePath } from "next/cache";
import { invalid } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { modifierGroupSchema } from "../../schemas/modifierGroup";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import * as groups from "../services/modifierGroups";

// Thin wrappers for Food › Modifiers › Groups: Manage Food, input parsing
// and refresh here; the rules are in services/modifierGroups.ts.

const requireManageFood = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
// The Food screens and the order screen's options pop-up.
const refresh = () => revalidatePath("/restaurant", "layout");

export async function createModifierGroup(input: unknown): Promise<groups.GroupResult> {
  return safely("create modifier group", async (): Promise<groups.GroupResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = modifierGroupSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await groups.createModifierGroup(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateModifierGroup(rawId: unknown, input: unknown): Promise<groups.GroupResult> {
  return safely("update modifier group", async (): Promise<groups.GroupResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: groups.GROUP_GONE };
    const parsed = modifierGroupSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await groups.updateModifierGroup(parsedId.data, parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteModifierGroup(rawId: unknown): Promise<groups.GroupResult> {
  return safely("delete modifier group", async (): Promise<groups.GroupResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: groups.GROUP_GONE };

    const result = await groups.deleteModifierGroup(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}
