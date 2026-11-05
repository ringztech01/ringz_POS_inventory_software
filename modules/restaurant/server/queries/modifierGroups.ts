import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { groupRuleLabel, groupType, isRequiredGroup } from "../../lib/modifiers";
import { GROUP_IN_USE } from "../services/modifierGroups";

// Food › Modifiers › Groups: live groups, in their order, with how many live
// menu items use each and how many modifiers it has.

export type ModifierGroupRow = {
  id: string;
  name: string;
  type: "Single choice" | "Multiple choice";
  // "required", "up to 2", "pick 1–3" (as the order screen says it).
  rule: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  items: number;
  modifiers: number;
  deleteBlocker: string | null;
};

export type GroupFilter = "required" | "optional" | null;

export function readGroupFilter(value: string | undefined): GroupFilter {
  return value === "required" || value === "optional" ? value : null;
}

export async function getModifierGroupList({ q, filter, page, perPage }: { q: string; filter: GroupFilter; page: number; perPage: number }) {
  const where: Prisma.ModifierGroupWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
    ...(filter === "required" ? { minSelect: { gte: 1 } } : filter === "optional" ? { minSelect: 0 } : {}),
  };
  const [total, groups] = await Promise.all([
    prisma.modifierGroup.count({ where }),
    prisma.modifierGroup.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        minSelect: true,
        maxSelect: true,
        _count: {
          select: {
            products: { where: { deletedAt: null, productType: "MENU_ITEM" } },
            modifiers: { where: { deletedAt: null } },
          },
        },
      },
    }),
  ]);
  const rows: ModifierGroupRow[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: groupType(g.maxSelect),
    rule: groupRuleLabel(g.minSelect, g.maxSelect),
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    required: isRequiredGroup(g.minSelect),
    items: g._count.products,
    modifiers: g._count.modifiers,
    deleteBlocker: g._count.products > 0 ? GROUP_IN_USE(g._count.products) : null,
  }));
  return { rows, total };
}
