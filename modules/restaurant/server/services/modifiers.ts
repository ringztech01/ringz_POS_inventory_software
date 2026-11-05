import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalid, type ActionResult } from "../../lib/actionResult";
import type { ModifierField, ModifierInput } from "../../schemas/modifier";
import { lockModifier, lockModifierGroup } from "../locks";

// Food › Modifiers › Modifiers: the rules behind create, edit, delete and
// rank — without the permission check and input parsing
// (../actions/modifiers.ts). Every write locks the modifier's group first, so
// name checks and re-numbering in one group queue up. Order lines already
// taken keep their own snapshot of the options ({ id, group, name, price }).

export type ModifierResult = ActionResult<ModifierField>;

export const MODIFIER_GONE = "Modifier not found. It may have been deleted.";
const GROUP_GONE = invalid<ModifierField>({ groupId: ["That group no longer exists."] });
export const MODIFIER_IN_USE = (lines: number) => `It's chosen on ${lines} ${lines === 1 ? "line" : "lines"} of an open order. Delete it once those orders are closed.`;
const nameTaken = () => invalid<ModifierField>({ name: ["This group already has a modifier with this name."] });

// Lines on open orders (not cancelled or removed) whose option snapshot
// includes the modifier.
export async function openLinesWith(db: Prisma.TransactionClient | PrismaClient, modifierId: string): Promise<number> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM OrderItem i JOIN \`Order\` o ON o.id = i.orderId
    WHERE i.deletedAt IS NULL AND i.cancelledAt IS NULL AND o.deletedAt IS NULL AND o.status IN ('OPEN', 'SENT', 'SERVED')
      AND JSON_SEARCH(i.modifiers, 'one', ${modifierId}, NULL, '$[*].id') IS NOT NULL`;
  return Number(row?.n ?? 0);
}

// Another live modifier in the group with this name (any case, by the collation)?
async function nameClash(tx: Prisma.TransactionClient, groupId: string, name: string, exceptId?: string) {
  return !!(await tx.modifier.findFirst({ where: { groupId, name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));
}

// New modifiers go last in their group.
async function nextRank(tx: Prisma.TransactionClient, groupId: string) {
  const last = await tx.modifier.aggregate({ where: { groupId, deletedAt: null }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? -1) + 1;
}

export async function createModifier(input: ModifierInput): Promise<ModifierResult> {
  return prisma.$transaction(async (tx): Promise<ModifierResult> => {
    if (!(await lockModifierGroup(tx, input.groupId))) return GROUP_GONE;
    if (await nameClash(tx, input.groupId, input.name)) return nameTaken();
    await tx.modifier.create({ data: { groupId: input.groupId, name: input.name, price: input.price, sortOrder: await nextRank(tx, input.groupId) } });
    return { ok: true };
  });
}

// Edit — including moving it to another group (it goes last there). The
// groups are locked in id order so two moves between the same pair can't
// deadlock.
export async function updateModifier(id: string, input: ModifierInput): Promise<ModifierResult> {
  return prisma.$transaction(async (tx): Promise<ModifierResult> => {
    const current = await tx.modifier.findFirst({ where: { id, deletedAt: null }, select: { groupId: true } });
    if (!current) return { ok: false, error: MODIFIER_GONE };
    for (const groupId of [...new Set([current.groupId, input.groupId])].sort()) {
      if (!(await lockModifierGroup(tx, groupId))) return groupId === input.groupId ? GROUP_GONE : { ok: false, error: MODIFIER_GONE };
    }
    const locked = await lockModifier(tx, id);
    if (!locked) return { ok: false, error: MODIFIER_GONE };
    if (await nameClash(tx, input.groupId, input.name, id)) return nameTaken();
    const moving = locked.groupId !== input.groupId;
    await tx.modifier.update({
      where: { id },
      data: { groupId: input.groupId, name: input.name, price: input.price, ...(moving ? { sortOrder: await nextRank(tx, input.groupId) } : {}) },
    });
    return { ok: true };
  });
}

// Soft delete — refused while it's chosen on a line of an open order.
export async function deleteModifier(id: string): Promise<ModifierResult> {
  return prisma.$transaction(async (tx): Promise<ModifierResult> => {
    const current = await tx.modifier.findFirst({ where: { id, deletedAt: null }, select: { groupId: true } });
    if (!current || !(await lockModifierGroup(tx, current.groupId)) || !(await lockModifier(tx, id))) return { ok: false, error: MODIFIER_GONE };
    const lines = await openLinesWith(tx, id);
    if (lines > 0) return { ok: false, error: MODIFIER_IN_USE(lines) };
    await tx.modifier.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });
}

// ↑ / ↓: swaps it with its neighbour; the group's ranks are renumbered
// 0, 1, 2 … on the way (old data may have gaps or ties).
export async function moveModifier(id: string, direction: "up" | "down"): Promise<ModifierResult> {
  return prisma.$transaction(async (tx): Promise<ModifierResult> => {
    const current = await tx.modifier.findFirst({ where: { id, deletedAt: null }, select: { groupId: true } });
    if (!current || !(await lockModifierGroup(tx, current.groupId))) return { ok: false, error: MODIFIER_GONE };
    const siblings = await tx.modifier.findMany({
      where: { groupId: current.groupId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const ids = siblings.map((s) => s.id);
    const at = ids.indexOf(id);
    const to = direction === "up" ? at - 1 : at + 1;
    if (at < 0) return { ok: false, error: MODIFIER_GONE };
    if (to < 0 || to >= ids.length) return { ok: true };
    [ids[at], ids[to]] = [ids[to], ids[at]];
    for (const [rank, modifierId] of ids.entries()) await tx.modifier.update({ where: { id: modifierId }, data: { sortOrder: rank } });
    return { ok: true };
  });
}
