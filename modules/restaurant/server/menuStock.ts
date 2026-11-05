import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { menuAvailability } from "../lib/menuAvailability";

type Db = PrismaClient | Prisma.TransactionClient;
type Dish = { id: string; recipeLines: { ingredientId: string; quantity: Prisma.Decimal }[] };

// Active recipe lines, as getMenu and the add-line rule load them.
export const recipeSelect = {
  where: { deletedAt: null, ingredient: { deletedAt: null } },
  select: { ingredientId: true, quantity: true },
} satisfies Prisma.Product$recipeLinesArgs;

// Which dishes can be made from `warehouseId` right now (the stock half of
// lib/menuAvailability.ts): a dish with a recipe needs every ingredient's
// stock to cover one serving; one without uses its own stock. The order
// screen dims the others, and adding them is refused.
export async function dishesInStock(db: Db, dishes: readonly Dish[], warehouseId: string): Promise<Set<string>> {
  const ids = [...new Set(dishes.flatMap((d) => (d.recipeLines.length ? d.recipeLines.map((r) => r.ingredientId) : [d.id])))];
  const rows = ids.length
    ? await db.productStock.findMany({ where: { warehouseId, productId: { in: ids } }, select: { productId: true, quantity: true } })
    : [];
  const stock = new Map(rows.map((row) => [row.productId, row.quantity]));
  return new Set(
    dishes
      .filter(
        (d) =>
          menuAvailability({
            isAvailable: true,
            recipe: d.recipeLines.map((r) => ({ quantity: r.quantity.toString(), stock: stock.get(r.ingredientId) ?? 0 })),
            ownStock: stock.get(d.id) ?? 0,
          }) === "available",
      )
      .map((d) => d.id),
  );
}
