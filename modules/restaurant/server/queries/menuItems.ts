import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { foodCost, marginPercent, recipeLineCost, trimQuantity } from "../../lib/foodCost";

// Food › Menu items: MENU_ITEM products only (retail STANDARD products and
// INGREDIENTs never show here), not deleted.

export type MenuItemRow = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: string;
  price: string;
  description: string | null;
  stationId: string | null;
  // The station's name; null = no station (first active station).
  station: string | null;
  isAvailable: boolean;
  showOnMenu: boolean;
  groups: string[];
  groupIds: string[];
  recipe: { name: string; quantity: string; unit: string; cost: string }[];
  // From the recipe; null when it has none (it tracks its own stock).
  foodCost: string | null;
  margin: number | null;
  // Why it can't be deleted, if it can't.
  deleteBlocker: string | null;
};

export type MenuItemListParams = { q: string; categoryId?: string; page: number; perPage: number };

const OPEN_ORDER_STATUSES = ["OPEN", "SENT", "SERVED"] as const;

export function menuItemsWhere({ q, categoryId }: { q: string; categoryId?: string }): Prisma.ProductWhereInput {
  return {
    productType: "MENU_ITEM",
    deletedAt: null,
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}),
  };
}

export async function getMenuItemList({ q, categoryId, page, perPage }: MenuItemListParams): Promise<{ rows: MenuItemRow[]; total: number }> {
  const where = menuItemsWhere({ q, categoryId });
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        menuDescription: true,
        isAvailable: true,
        showOnMenu: true,
        categoryId: true,
        stationId: true,
        category: { select: { name: true } },
        kitchenStation: { select: { name: true, deletedAt: true } },
        modifierGroups: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } },
        recipeLines: {
          where: { deletedAt: null, ingredient: { deletedAt: null } },
          orderBy: { createdAt: "asc" },
          select: { quantity: true, ingredient: { select: { name: true, cost: true, unit: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const ids = items.map((item) => item.id);
  const [onOpenOrders, inRecipes] = await Promise.all([
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, deletedAt: null, order: { deletedAt: null, status: { in: [...OPEN_ORDER_STATUSES] } } },
      _count: { _all: true },
    }),
    prisma.recipeLine.groupBy({
      by: ["ingredientId"],
      where: { ingredientId: { in: ids }, deletedAt: null, menuItem: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  const open = new Set(onOpenOrders.map((row) => row.productId));
  const used = new Set(inRecipes.map((row) => row.ingredientId));

  const rows = items.map((item): MenuItemRow => {
    const lines = item.recipeLines.map((line) => ({ quantity: line.quantity, unitCost: line.ingredient.cost }));
    const cost = lines.length ? foodCost(lines) : null;
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      categoryId: item.categoryId,
      category: item.category.name,
      price: item.price.toFixed(2),
      description: item.menuDescription,
      stationId: item.stationId,
      station: item.kitchenStation && !item.kitchenStation.deletedAt ? item.kitchenStation.name : null,
      isAvailable: item.isAvailable,
      showOnMenu: item.showOnMenu,
      groups: item.modifierGroups.map((g) => g.name),
      groupIds: item.modifierGroups.map((g) => g.id),
      recipe: item.recipeLines.map((line) => ({
        name: line.ingredient.name,
        quantity: trimQuantity(line.quantity),
        unit: line.ingredient.unit.name,
        cost: recipeLineCost(line.quantity, line.ingredient.cost).toFixed(2),
      })),
      foodCost: cost ? cost.toFixed(2) : null,
      margin: cost ? marginPercent(item.price, cost) : null,
      deleteBlocker: open.has(item.id)
        ? "It's on an open order. Delete it once those orders are closed."
        : used.has(item.id)
          ? "It's used in a recipe. Take it out of the recipe first."
          : null,
    };
  });
  return { rows, total };
}

// The category filter and the modal's Category select: every category.
export async function getMenuCategories(): Promise<{ id: string; name: string }[]> {
  return prisma.category.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
