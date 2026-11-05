"use server";

import { revalidatePath } from "next/cache";
import { invalid } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { modifierSchema, moveModifierSchema } from "../../schemas/modifier";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import * as modifiers from "../services/modifiers";

// Thin wrappers for Food › Modifiers › Modifiers: Manage Food, input parsing
// and refresh here; the rules are in services/modifiers.ts.

const requireManageFood = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
// The Food screens and the order screen's options pop-up.
const refresh = () => revalidatePath("/restaurant", "layout");

export async function createModifier(input: unknown): Promise<modifiers.ModifierResult> {
  return safely("create modifier", async (): Promise<modifiers.ModifierResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = modifierSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await modifiers.createModifier(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateModifier(rawId: unknown, input: unknown): Promise<modifiers.ModifierResult> {
  return safely("update modifier", async (): Promise<modifiers.ModifierResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: modifiers.MODIFIER_GONE };
    const parsed = modifierSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await modifiers.updateModifier(parsedId.data, parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteModifier(rawId: unknown): Promise<modifiers.ModifierResult> {
  return safely("delete modifier", async (): Promise<modifiers.ModifierResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: modifiers.MODIFIER_GONE };

    const result = await modifiers.deleteModifier(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function moveModifier(input: unknown): Promise<modifiers.ModifierResult> {
  return safely("move modifier", async (): Promise<modifiers.ModifierResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = moveModifierSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That move isn't valid." };

    const result = await modifiers.moveModifier(parsed.data.id, parsed.data.direction);
    if (result.ok) refresh();
    return result;
  });
}
