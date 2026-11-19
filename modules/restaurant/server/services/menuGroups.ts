import "server-only";
import type { MenuDepartment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { departmentOf } from "../../lib/posGrid";
import { placeCells } from "../../lib/posMenu";
import type { MenuGroupField, MenuGroupInput, PlaceButtonInput } from "../../schemas/menuGroup";
import type { PosSettingsInput } from "../../schemas/pos";
import { lockMenuItem } from "../locks";

// Food › POS buttons: the rules behind the touch POS's button groups and
// where each button sits — without the permission check and input parsing
// (../actions/menuGroups.ts). Every change locks the live groups first, so
// two editors' changes queue up instead of crossing.

export type MenuGroupResult = ActionResult<MenuGroupField>;

export const MENU_GROUP_GONE = "That group isn't there any more. Refresh and try again.";
export const DISH_GONE = "That dish isn't on the menu any more. Refresh and try again.";

type GroupRow = { id: string; name: string; parentId: string | null; department: MenuDepartment; rank: number; gridPosition: number | null };

async function lockGroups(tx: Prisma.TransactionClient): Promise<GroupRow[]> {
  const rows = await tx.$queryRaw<(Omit<GroupRow, "rank" | "gridPosition"> & { rank: number | bigint; gridPosition: number | bigint | null })[]>`
    SELECT id, name, parentId, department, \`rank\`, gridPosition FROM MenuGroup WHERE deletedAt IS NULL FOR UPDATE`;
  return rows.map((r) => ({ ...r, rank: Number(r.rank), gridPosition: r.gridPosition === null ? null : Number(r.gridPosition) }));
}

// The group and every group inside it.
function familyOf(rows: GroupRow[], id: string): Set<string> {
  const family = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of rows) {
      if (row.parentId && family.has(row.parentId) && !family.has(row.id)) {
        family.add(row.id);
        grew = true;
      }
    }
  }
  return family;
}

const siblingsOf = (rows: GroupRow[], parentId: string | null, department: MenuDepartment) =>
  rows.filter((r) => r.parentId === parentId && (parentId !== null || r.department === department));

const nextRank = (siblings: GroupRow[]) => Math.max(-1, ...siblings.map((s) => s.rank)) + 1;

// Where a group may go: its parent must be live, not itself or inside it;
// a sub-group takes its parent's department.
function checkParent(rows: GroupRow[], input: MenuGroupInput, id?: string): { department: MenuDepartment } | { error: MenuGroupResult } {
  if (!input.parentId) return { department: input.department };
  const parent = rows.find((r) => r.id === input.parentId);
  if (!parent) return { error: invalid<MenuGroupField>({ parentId: ["That group isn't there any more. Pick another."] }) };
  if (id && familyOf(rows, id).has(parent.id)) return { error: invalid<MenuGroupField>({ parentId: ["A group can't go inside itself or one of its own sub-groups."] }) };
  return { department: parent.department };
}

export async function createMenuGroup(input: MenuGroupInput): Promise<MenuGroupResult> {
  return prisma.$transaction(async (tx): Promise<MenuGroupResult> => {
    const rows = await lockGroups(tx);
    const placed = checkParent(rows, input);
    if ("error" in placed) return placed.error;
    await tx.menuGroup.create({
      data: { name: input.name, parentId: input.parentId, department: placed.department, colour: input.colour, rank: nextRank(siblingsOf(rows, input.parentId, placed.department)) },
    });
    return { ok: true };
  });
}

// Moving a group to another parent (or department) puts it last there, in
// the next free cell; everything inside it follows to the new department.
export async function updateMenuGroup(id: string, input: MenuGroupInput): Promise<MenuGroupResult> {
  return prisma.$transaction(async (tx): Promise<MenuGroupResult> => {
    const rows = await lockGroups(tx);
    const group = rows.find((r) => r.id === id);
    if (!group) return { ok: false, error: MENU_GROUP_GONE };
    const placed = checkParent(rows, input, id);
    if ("error" in placed) return placed.error;
    const moved = group.parentId !== input.parentId || (input.parentId === null && group.department !== placed.department);
    await tx.menuGroup.update({
      where: { id },
      data: {
        name: input.name,
        colour: input.colour,
        parentId: input.parentId,
        department: placed.department,
        ...(moved ? { rank: nextRank(siblingsOf(rows, input.parentId, placed.department).filter((r) => r.id !== id)), gridPosition: null } : {}),
      },
    });
    if (placed.department !== group.department) {
      await tx.menuGroup.updateMany({ where: { id: { in: [...familyOf(rows, id)] } }, data: { department: placed.department } });
    }
    return { ok: true };
  });
}

// Refused while it has sub-groups; its dishes go back to "not placed" (on
// the POS they show under their category until placed again).
export async function deleteMenuGroup(id: string): Promise<ActionResult & { dishes?: number }> {
  return prisma.$transaction(async (tx) => {
    const rows = await lockGroups(tx);
    if (!rows.some((r) => r.id === id)) return { ok: false as const, error: MENU_GROUP_GONE };
    const subGroups = rows.filter((r) => r.parentId === id).length;
    if (subGroups > 0) return { ok: false as const, error: `It has ${subGroups} sub-${subGroups === 1 ? "group" : "groups"}. Move or delete ${subGroups === 1 ? "it" : "them"} first.` };
    const { count } = await tx.product.updateMany({ where: { menuGroupId: id }, data: { menuGroupId: null, menuGridPosition: null } });
    await tx.menuGroup.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true as const, dishes: count };
  });
}

// One place up or down in the groups row / the list (among its siblings).
export async function moveMenuGroupRank(id: string, direction: "up" | "down"): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const rows = await lockGroups(tx);
    const group = rows.find((r) => r.id === id);
    if (!group) return { ok: false, error: MENU_GROUP_GONE };
    const siblings = siblingsOf(rows, group.parentId, group.department).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    const at = siblings.findIndex((s) => s.id === id);
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= siblings.length) return { ok: true };
    [siblings[at], siblings[to]] = [siblings[to], siblings[at]];
    for (const [rank, sibling] of siblings.entries()) {
      if (sibling.rank !== rank) await tx.menuGroup.update({ where: { id: sibling.id }, data: { rank } });
    }
    return { ok: true };
  });
}

type Button = { key: string; kind: "group" | "item"; id: string; position: number | null };

// Drop a button on a cell. Every button in that grid is then saved at the
// cell it shows in (nothing shifts later); the one already on the cell swaps
// with the dropped button — or, for a dish arriving from elsewhere, takes
// the first free cell.
export async function placeMenuButton(input: PlaceButtonInput): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const rows = await lockGroups(tx);
    if (input.groupId && !rows.some((r) => r.id === input.groupId)) return { ok: false, error: MENU_GROUP_GONE };
    if (input.kind === "item" && !input.groupId) return { ok: false, error: "Dishes go inside a group. Open a group first." };

    const groups = siblingsOf(rows, input.groupId, input.department).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    const dishes = input.groupId
      ? await tx.$queryRaw<{ id: string; name: string; menuGridPosition: number | bigint | null }[]>`
          SELECT id, name, menuGridPosition FROM Product
          WHERE menuGroupId = ${input.groupId} AND productType = 'MENU_ITEM' AND deletedAt IS NULL ORDER BY name FOR UPDATE`
      : [];
    const buttons: Button[] = [
      ...groups.map((g) => ({ key: `group:${g.id}`, kind: "group" as const, id: g.id, position: g.gridPosition })),
      ...dishes.map((d) => ({ key: `item:${d.id}`, kind: "item" as const, id: d.id, position: d.menuGridPosition === null ? null : Number(d.menuGridPosition) })),
    ];

    const key = `${input.kind}:${input.id}`;
    let arriving = false;
    if (!buttons.some((b) => b.key === key)) {
      if (input.kind === "group") return { ok: false, error: "That group is somewhere else now. Refresh and try again." };
      if (!(await lockMenuItem(tx, input.id))) return { ok: false, error: DISH_GONE };
      arriving = true;
    }

    const cells = placeCells(buttons);
    const at = new Map<string, number>();
    cells.forEach((cell, i) => cell && at.set(cell.key, i));
    const occupant = cells[input.cell] ?? null;
    if (occupant && occupant.key !== key) {
      const from = at.get(key);
      if (from !== undefined) at.set(occupant.key, from);
      else {
        let free = 0;
        while (free === input.cell || cells[free]) free++;
        at.set(occupant.key, free);
      }
    }
    at.set(key, input.cell);

    const all: Button[] = arriving ? [...buttons, { key, kind: "item", id: input.id, position: null }] : buttons;
    for (const button of all) {
      const cell = at.get(button.key)!;
      const joins = arriving && button.key === key;
      if (!joins && button.position === cell) continue;
      if (button.kind === "group") await tx.menuGroup.update({ where: { id: button.id }, data: { gridPosition: cell } });
      else await tx.product.update({ where: { id: button.id }, data: { menuGridPosition: cell, ...(joins ? { menuGroupId: input.groupId } : {}) } });
    }
    return { ok: true };
  });
}

// A dish back to "not placed" (on the POS: under its category).
export async function unplaceDish(id: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    if (!(await lockMenuItem(tx, id))) return { ok: false, error: DISH_GONE };
    await tx.product.update({ where: { id }, data: { menuGroupId: null, menuGridPosition: null } });
    return { ok: true };
  });
}

// A head start: every dish not placed yet goes into a top group named after
// its category, on its station's side (an existing group of that name is
// used). Groups already set up are left as they are.
export async function groupsFromCategories(): Promise<ActionResult & { groups?: number; dishes?: number }> {
  return prisma.$transaction(async (tx) => {
    const rows = await lockGroups(tx);
    const dishes = await tx.product.findMany({
      where: { productType: "MENU_ITEM", deletedAt: null, OR: [{ menuGroupId: null }, { menuGroup: { deletedAt: { not: null } } }] },
      select: { id: true, prepStation: true, kitchenStation: { select: { code: true } }, category: { select: { name: true } } },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });
    const roots = new Map(rows.filter((r) => r.parentId === null).map((r) => [`${r.department}:${r.name.toLowerCase()}`, r.id]));
    const ranks = { FOOD: nextRank(siblingsOf(rows, null, "FOOD")), BAR: nextRank(siblingsOf(rows, null, "BAR")) };
    let created = 0;
    const into = new Map<string, string[]>();
    for (const dish of dishes) {
      const department = departmentOf(dish.kitchenStation?.code ?? null, dish.prepStation);
      const name = dish.category.name.trim().slice(0, 40) || "Other";
      const lookup = `${department}:${name.toLowerCase()}`;
      let groupId = roots.get(lookup);
      if (!groupId) {
        groupId = (await tx.menuGroup.create({ data: { name, department, rank: ranks[department]++ }, select: { id: true } })).id;
        roots.set(lookup, groupId);
        created++;
      }
      into.set(groupId, [...(into.get(groupId) ?? []), dish.id]);
    }
    for (const [groupId, ids] of into) {
      await tx.product.updateMany({ where: { id: { in: ids } }, data: { menuGroupId: groupId, menuGridPosition: null } });
    }
    return { ok: true as const, groups: created, dishes: dishes.length };
  });
}

export async function setQuickNotes(notes: string[]): Promise<ActionResult> {
  await prisma.businessSetting.upsert({
    where: { id: BUSINESS_SETTINGS_ID },
    create: { id: BUSINESS_SETTINGS_ID, restaurantQuickNotes: notes },
    update: { restaurantQuickNotes: notes },
  });
  return { ok: true };
}

// Touch POS settings (Restaurant › Touch POS): after a dish is added, after
// Send, auto-lock and the theme.
export async function setPosSettings(input: PosSettingsInput): Promise<ActionResult> {
  const data = { restaurantPosReturnHome: input.returnHome, restaurantPosSendToFloor: input.sendToFloor, restaurantPosLockSeconds: input.lockSeconds, restaurantPosLockSecondsManager: input.lockSecondsManager, restaurantPosLightTheme: input.lightTheme, restaurantTabletColumns: input.tabletColumns, restaurantTabletWakeLock: input.tabletWakeLock };
  await prisma.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, ...data }, update: data });
  return { ok: true };
}
