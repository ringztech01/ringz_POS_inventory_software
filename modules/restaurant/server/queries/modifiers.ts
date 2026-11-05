import "server-only";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/format";
import { groupRuleLabel } from "../../lib/modifiers";

// Read-only modifier data for the order screen (groups and options are
// managed in Food › Modifiers). Groups and options that are soft-deleted, and
// groups with no options left, are left out; options in their rank order.

export type ModifierOptionView = {
  id: string;
  name: string;
  // "+₦4.00", or "" for no price change. Formatted here — the browser
  // never adds prices up.
  price: string;
};

export type ModifierGroupView = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  // "required", "up to 2" …
  rule: string;
  options: ModifierOptionView[];
};

const groupSelect = {
  where: { deletedAt: null },
  select: {
    id: true,
    name: true,
    minSelect: true,
    maxSelect: true,
    modifiers: {
      where: { deletedAt: null },
      select: { id: true, name: true, price: true },
      orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
    },
  },
  orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }],
};

// productId → its groups, in order.
export async function getModifierGroupsFor(productIds: readonly string[]): Promise<Record<string, ModifierGroupView[]>> {
  if (productIds.length === 0) return {};
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    select: { id: true, modifierGroups: groupSelect },
  });
  return Object.fromEntries(
    products.map((product) => [
      product.id,
      product.modifierGroups
        .filter((group) => group.modifiers.length > 0)
        .map((group) => ({
          id: group.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          rule: groupRuleLabel(group.minSelect, group.maxSelect),
          options: group.modifiers.map((m) => ({
            id: m.id,
            name: m.name,
            price: m.price.isZero() ? "" : `+${formatNaira(m.price.toFixed(2))}`,
          })),
        })),
    ]),
  );
}
