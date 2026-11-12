"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { menuGroupSchema, moveGroupRankSchema, placeButtonSchema, quickNotesSchema } from "../../schemas/menuGroup";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import * as menuGroups from "../services/menuGroups";

// Thin wrappers for Food › POS buttons: Manage Food, input parsing and
// refresh here; the rules are in services/menuGroups.ts.

const requireManageFood = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
// The Food screens, the order screen's menu and the touch POS.
const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos");
};
const REFRESH_AND_RETRY = "That changed meanwhile. Refresh and try again.";

export async function createMenuGroup(input: unknown): Promise<menuGroups.MenuGroupResult> {
  return safely("create menu group", async (): Promise<menuGroups.MenuGroupResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = menuGroupSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const result = await menuGroups.createMenuGroup(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateMenuGroup(rawId: unknown, input: unknown): Promise<menuGroups.MenuGroupResult> {
  return safely("update menu group", async (): Promise<menuGroups.MenuGroupResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, error: menuGroups.MENU_GROUP_GONE };
    const parsed = menuGroupSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
    const result = await menuGroups.updateMenuGroup(id.data, parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteMenuGroup(rawId: unknown): Promise<ActionResult & { dishes?: number }> {
  return safely("delete menu group", async () => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false as const, error: menuGroups.MENU_GROUP_GONE };
    const result = await menuGroups.deleteMenuGroup(id.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function moveMenuGroupRank(input: unknown): Promise<ActionResult> {
  return safely("move menu group", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = moveGroupRankSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: REFRESH_AND_RETRY };
    const result = await menuGroups.moveMenuGroupRank(parsed.data.id, parsed.data.direction);
    if (result.ok) refresh();
    return result;
  });
}

export async function placeMenuButton(input: unknown): Promise<ActionResult> {
  return safely("place menu button", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = placeButtonSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: REFRESH_AND_RETRY };
    const result = await menuGroups.placeMenuButton(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function unplaceDish(rawId: unknown): Promise<ActionResult> {
  return safely("unplace dish", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const id = idSchema.safeParse(rawId);
    if (!id.success) return { ok: false, error: menuGroups.DISH_GONE };
    const result = await menuGroups.unplaceDish(id.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function groupsFromCategories(): Promise<ActionResult & { groups?: number; dishes?: number }> {
  return safely("groups from categories", async () => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const result = await menuGroups.groupsFromCategories();
    if (result.ok) refresh();
    return result;
  });
}

export async function setQuickNotes(input: unknown): Promise<ActionResult> {
  return safely("set quick notes", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = quickNotesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? REFRESH_AND_RETRY };
    const result = await menuGroups.setQuickNotes(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}
