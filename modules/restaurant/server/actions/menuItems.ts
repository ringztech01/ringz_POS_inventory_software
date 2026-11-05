"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { itemGroupSchema, menuItemFlagSchema, menuItemSchema } from "../../schemas/menuItem";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import * as menuItems from "../services/menuItems";

// Thin wrappers for Food › Menu items: Manage Food, input parsing and
// refresh here; the rules are in services/menuItems.ts.

const requireManageFood = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
// The Food screens, the order screen's menu and (later) the digital menu.
const refresh = () => revalidatePath("/restaurant", "layout");

export async function createMenuItem(input: unknown): Promise<menuItems.MenuItemResult> {
  return safely("create menu item", async (): Promise<menuItems.MenuItemResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = menuItemSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await menuItems.createMenuItem(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function updateMenuItem(rawId: unknown, input: unknown): Promise<menuItems.MenuItemResult> {
  return safely("update menu item", async (): Promise<menuItems.MenuItemResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: menuItems.MENU_ITEM_GONE };
    const parsed = menuItemSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await menuItems.updateMenuItem(parsedId.data, parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteMenuItem(rawId: unknown): Promise<menuItems.MenuItemResult> {
  return safely("delete menu item", async (): Promise<menuItems.MenuItemResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawId);
    if (!parsedId.success) return { ok: false, error: menuItems.MENU_ITEM_GONE };

    const result = await menuItems.deleteMenuItem(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}

// The list's Available / On menu switches.
export async function setMenuItemFlag(input: unknown): Promise<ActionResult> {
  return safely("set menu item flag", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = menuItemFlagSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid." };

    const result = await menuItems.setMenuItemFlag(parsed.data.id, parsed.data.field, parsed.data.value);
    if (result.ok) refresh();
    return result;
  });
}

// The Modifiers pop-up: one group on or off the item.
export async function setMenuItemGroup(input: unknown): Promise<ActionResult> {
  return safely("set menu item modifier group", async (): Promise<ActionResult> => {
    const authCheck = await requireManageFood();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = itemGroupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid." };

    const result = await menuItems.setItemModifierGroup(parsed.data.productId, parsed.data.groupId, parsed.data.attached);
    if (result.ok) refresh();
    return result;
  });
}
