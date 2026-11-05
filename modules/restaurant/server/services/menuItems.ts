import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import type { MenuItemField, MenuItemInput } from "../../schemas/menuItem";
import { lockMenuItem } from "../locks";
import { isUniqueViolation } from "../prismaErrors";

// Food › Menu items: the rules behind create, edit, delete and the Available
// / On menu switches — without the permission check and input parsing
// (../actions/menuItems.ts does those). Menu items are Products with
// productType MENU_ITEM; nothing here touches stock or any order line
// (lines keep their own price snapshots).

export type MenuItemResult = ActionResult<MenuItemField>;

export const MENU_ITEM_GONE = "Menu item not found. It may have been deleted.";
export const ON_OPEN_ORDER = "It's on an open order. Delete it once those orders are closed.";
export const IN_A_RECIPE = "It's used in a recipe. Take it out of the recipe first.";
const codeTaken = () => invalid<MenuItemField>({ code: ["Another product already uses this code."] });
const OPEN_ORDER_STATUSES = ["OPEN", "SENT", "SERVED"] as const;

// Every Product needs a brand and a unit; menu items get "Restaurant" and
// "pc", made once if they don't exist yet.
async function menuDefaults(tx: Prisma.TransactionClient) {
  const brand =
    (await tx.brand.findFirst({ where: { name: "Restaurant", deletedAt: null }, select: { id: true } })) ??
    (await tx.brand.create({ data: { name: "Restaurant" }, select: { id: true } }));
  const unit =
    (await tx.unit.findFirst({ where: { name: "pc", deletedAt: null }, select: { id: true } })) ??
    (await tx.unit.create({ data: { name: "pc" }, select: { id: true } }));
  return { brandId: brand.id, unitId: unit.id };
}

// The category and station must exist (the station may be switched off).
async function checkRefs(tx: Prisma.TransactionClient, input: MenuItemInput): Promise<MenuItemResult | null> {
  const category = await tx.category.findFirst({ where: { id: input.categoryId, deletedAt: null }, select: { id: true } });
  if (!category) return invalid<MenuItemField>({ categoryId: ["Choose a category."] });
  if (input.stationId) {
    const station = await tx.kitchenStation.findFirst({ where: { id: input.stationId, deletedAt: null }, select: { id: true } });
    if (!station) return invalid<MenuItemField>({ stationId: ["That station no longer exists."] });
  }
  return null;
}

// Product codes are unique across every product (retail, ingredients,
// deleted ones too — the unique index keeps them).
async function codeClash(tx: Prisma.TransactionClient, code: string, exceptId?: string) {
  return !!(await tx.product.findFirst({ where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));
}

const fields = (input: MenuItemInput) => ({
  code: input.code,
  name: input.name,
  categoryId: input.categoryId,
  price: input.price,
  menuDescription: input.description,
  stationId: input.stationId,
});

// The unique index on code is the last word if two saves race.
async function saving(body: () => Promise<MenuItemResult>): Promise<MenuItemResult> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error, "code")) return codeTaken();
    throw error;
  }
}

// New items are Available but not yet On menu (switched on when ready).
export async function createMenuItem(input: MenuItemInput): Promise<MenuItemResult> {
  return saving(() =>
    prisma.$transaction(async (tx): Promise<MenuItemResult> => {
      const refs = await checkRefs(tx, input);
      if (refs) return refs;
      if (await codeClash(tx, input.code)) return codeTaken();
      await tx.product.create({
        data: { ...fields(input), ...(await menuDefaults(tx)), productType: "MENU_ITEM", taxType: "EXCLUSIVE", isAvailable: true, showOnMenu: false },
      });
      return { ok: true };
    }),
  );
}

export async function updateMenuItem(id: string, input: MenuItemInput): Promise<MenuItemResult> {
  return saving(() =>
    prisma.$transaction(async (tx): Promise<MenuItemResult> => {
      if (!(await lockMenuItem(tx, id))) return { ok: false, error: MENU_ITEM_GONE };
      const refs = await checkRefs(tx, input);
      if (refs) return refs;
      if (await codeClash(tx, input.code, id)) return codeTaken();
      await tx.product.update({ where: { id }, data: fields(input) });
      return { ok: true };
    }),
  );
}

// Soft delete — refused while it's on an open order (New or sent) or used
// in a recipe. Its own recipe lines go with it; billed history keeps it.
export async function deleteMenuItem(id: string): Promise<MenuItemResult> {
  return prisma.$transaction(async (tx): Promise<MenuItemResult> => {
    if (!(await lockMenuItem(tx, id))) return { ok: false, error: MENU_ITEM_GONE };
    const open = await tx.orderItem.count({ where: { productId: id, deletedAt: null, order: { deletedAt: null, status: { in: [...OPEN_ORDER_STATUSES] } } } });
    if (open > 0) return { ok: false, error: ON_OPEN_ORDER };
    const used = await tx.recipeLine.count({ where: { ingredientId: id, deletedAt: null, menuItem: { deletedAt: null } } });
    if (used > 0) return { ok: false, error: IN_A_RECIPE };
    const now = new Date();
    await tx.recipeLine.updateMany({ where: { menuItemId: id, deletedAt: null }, data: { deletedAt: now } });
    await tx.product.update({ where: { id }, data: { deletedAt: now } });
    return { ok: true };
  });
}

// Available / On menu, from the list's switches. Neither touches stock.
export async function setMenuItemFlag(id: string, field: "isAvailable" | "showOnMenu", value: boolean): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const updated = await tx.product.updateMany({ where: { id, productType: "MENU_ITEM", deletedAt: null }, data: { [field]: value } });
    return updated.count === 1 ? { ok: true } : { ok: false, error: MENU_ITEM_GONE };
  });
}

export const GROUP_NOT_FOUND = "That modifier group no longer exists — refreshed.";

// A modifier group on or off a menu item. The item is locked so two
// switches on it queue up; doing what's already done is fine. Lines already
// ordered keep their option snapshots either way.
export async function setItemModifierGroup(productId: string, groupId: string, attached: boolean): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    if (!(await lockMenuItem(tx, productId))) return { ok: false, error: MENU_ITEM_GONE };
    if (attached) {
      const group = await tx.modifierGroup.findFirst({ where: { id: groupId, deletedAt: null }, select: { id: true } });
      if (!group) return { ok: false, error: GROUP_NOT_FOUND };
    }
    await tx.product.update({
      where: { id: productId },
      data: { modifierGroups: attached ? { connect: { id: groupId } } : { disconnect: { id: groupId } } },
    });
    return { ok: true };
  });
}
