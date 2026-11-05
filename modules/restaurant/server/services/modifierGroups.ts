import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import type { ModifierGroupField, ModifierGroupInput } from "../../schemas/modifierGroup";
import { lockModifierGroup } from "../locks";

// Food › Modifiers › Groups: the rules behind create, edit and delete —
// without the permission check and input parsing (../actions/modifierGroups.ts).
// Groups are shared: one group belongs to many menu items. Creating a group
// doesn't create any modifiers.

export type GroupResult = ActionResult<ModifierGroupField>;

export const GROUP_GONE = "Modifier group not found. It may have been deleted.";
export const GROUP_IN_USE = (items: number) => `It's on ${items} menu ${items === 1 ? "item" : "items"}. Take it off them first.`;
const nameTaken = () => invalid<ModifierGroupField>({ name: ["Another modifier group already has this name."] });

// Live menu items using the group.
export function itemsUsing(tx: Prisma.TransactionClient, groupId: string) {
  return tx.product.count({ where: { deletedAt: null, productType: "MENU_ITEM", modifierGroups: { some: { id: groupId } } } });
}

// Another live group with this name (case-insensitive by the collation)?
// A locking read: with no index on name it locks the rows (and gaps) it
// scans, so two saves of the same new name queue up instead of both passing.
async function nameClash(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ModifierGroup WHERE name = ${name} AND deletedAt IS NULL FOR UPDATE`;
  return rows.some((row) => row.id !== exceptId);
}

const data = (input: ModifierGroupInput) => ({ name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect });

// Two saves that lock each other's rows: MariaDB picks one as a deadlock
// victim; run it once more and it sees the other's result.
async function once<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return body();
    throw error;
  }
}

// New groups go last.
export async function createModifierGroup(input: ModifierGroupInput): Promise<GroupResult> {
  return once(() =>
    prisma.$transaction(async (tx): Promise<GroupResult> => {
      if (await nameClash(tx, input.name)) return nameTaken();
      const last = await tx.modifierGroup.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
      await tx.modifierGroup.create({ data: { ...data(input), sortOrder: (last._max.sortOrder ?? -1) + 1 } });
      return { ok: true };
    }),
  );
}

// Changing the rules doesn't touch lines already ordered (their options are
// snapshots); new orders follow the new rules.
export async function updateModifierGroup(id: string, input: ModifierGroupInput): Promise<GroupResult> {
  return once(() =>
    prisma.$transaction(async (tx): Promise<GroupResult> => {
      if (!(await lockModifierGroup(tx, id))) return { ok: false, error: GROUP_GONE };
      if (await nameClash(tx, input.name, id)) return nameTaken();
      await tx.modifierGroup.update({ where: { id }, data: data(input) });
      return { ok: true };
    }),
  );
}

// Soft delete with its modifiers — refused while any live menu item uses it.
export async function deleteModifierGroup(id: string): Promise<GroupResult> {
  return prisma.$transaction(async (tx): Promise<GroupResult> => {
    if (!(await lockModifierGroup(tx, id))) return { ok: false, error: GROUP_GONE };
    const items = await itemsUsing(tx, id);
    if (items > 0) return { ok: false, error: GROUP_IN_USE(items) };
    const now = new Date();
    await tx.modifier.updateMany({ where: { groupId: id, deletedAt: null }, data: { deletedAt: now } });
    await tx.modifierGroup.update({ where: { id }, data: { deletedAt: now } });
    return { ok: true };
  });
}
