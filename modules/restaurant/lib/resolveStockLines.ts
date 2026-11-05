import type { ProductType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";

// What leaves stock when lines are sold — run inside the settle transaction
// (Part 6), between loading the sold lines and the stock service. It only
// pre-processes the input; the stock service itself is unchanged.
//
//   A product with no recipe (any STANDARD product, a MENU_ITEM that tracks
//   its own stock, an INGREDIENT sold as is): one move, its own quantity.
//   A MENU_ITEM with a recipe: one move per ingredient, the line quantity ×
//   the recipe quantity (per serving, in the ingredient's own unit).
//
// Moves of the same product are added together (rice from the Jollof and
// from the Fried rice is one move) and come back sorted by product id, so the
// settle always locks stock rows in the same order. Quantities are Decimal
// and never rounded — 2 × 0.333 kg is 0.666 kg.

export type SoldLine = {
  productId: string;
  productName: string;
  productType: ProductType;
  // How many were sold on this line (OrderItem.quantity).
  quantity: Decimal.Value;
  // The item's live recipe lines (empty or absent: none). Only used for
  // MENU_ITEMs.
  recipe?: readonly { ingredientId: string; ingredientName: string; quantity: Decimal.Value }[];
};

export type StockMoveLine = { productId: string; productName: string; quantity: Decimal };

export function resolveStockLines(lines: readonly SoldLine[]): StockMoveLine[] {
  const moves = new Map<string, StockMoveLine>();
  const add = (productId: string, productName: string, quantity: Decimal) => {
    if (quantity.lessThanOrEqualTo(0)) return;
    const current = moves.get(productId);
    moves.set(productId, { productId, productName, quantity: current ? current.quantity.plus(quantity) : quantity });
  };

  for (const line of lines) {
    const sold = new Decimal(line.quantity);
    const recipe = line.productType === "MENU_ITEM" ? (line.recipe ?? []) : [];
    if (recipe.length === 0) {
      add(line.productId, line.productName, sold);
      continue;
    }
    for (const ingredient of recipe) add(ingredient.ingredientId, ingredient.ingredientName, sold.times(ingredient.quantity));
  }

  return [...moves.values()].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}
