import "server-only";
import { prisma } from "@/lib/db";
import { MODIFIER_IN_USE, openLinesWith } from "../services/modifiers";

// Food › Modifiers › Modifiers: the live groups (for the dropdowns) and the
// live modifiers in one group, in rank order.

export type ModifierGroupOption = { id: string; name: string; rule: { minSelect: number; maxSelect: number }; modifiers: number };

export type ModifierRow = {
  id: string;
  groupId: string;
  name: string;
  // 2dp, may be negative ("-1.00").
  price: string;
  rank: number;
  deleteBlocker: string | null;
};

export async function getModifierGroupOptions(): Promise<ModifierGroupOption[]> {
  const groups = await prisma.modifierGroup.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, minSelect: true, maxSelect: true, _count: { select: { modifiers: { where: { deletedAt: null } } } } },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, rule: { minSelect: g.minSelect, maxSelect: g.maxSelect }, modifiers: g._count.modifiers }));
}

export async function getModifiersInGroup(groupId: string): Promise<ModifierRow[]> {
  const modifiers = await prisma.modifier.findMany({
    where: { groupId, deletedAt: null, group: { deletedAt: null } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, groupId: true, name: true, price: true },
  });
  const inUse = await Promise.all(modifiers.map((m) => openLinesWith(prisma, m.id)));
  return modifiers.map((m, i) => ({
    id: m.id,
    groupId: m.groupId,
    name: m.name,
    price: m.price.toFixed(2),
    rank: i + 1,
    deleteBlocker: inUse[i] > 0 ? MODIFIER_IN_USE(inUse[i]) : null,
  }));
}
