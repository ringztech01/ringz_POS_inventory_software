import { Decimal } from "@prisma/client/runtime/index-browser";

// Food cost and margin for menu items (Food screen). A recipe line costs its
// quantity × the ingredient's unit cost (Product.cost — none counts as 0);
// an item's food cost is the sum of its lines; margin is
// (price − food cost) / price × 100. Kept as Decimal; rounded only to show.

export function recipeLineCost(quantity: Decimal.Value, unitCost: Decimal.Value | null): Decimal {
  return new Decimal(quantity).times(unitCost ?? 0);
}

export function foodCost(lines: readonly { quantity: Decimal.Value; unitCost: Decimal.Value | null }[]): Decimal {
  return lines.reduce((sum, line) => sum.plus(recipeLineCost(line.quantity, line.unitCost)), new Decimal(0));
}

// Whole percent; null when there's no price to measure against.
export function marginPercent(price: Decimal.Value, cost: Decimal.Value): number | null {
  const p = new Decimal(price);
  if (p.lessThanOrEqualTo(0)) return null;
  return p.minus(cost).div(p).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

// "0.25" for a stored 0.250 (recipe quantities have 3 decimals).
export function trimQuantity(quantity: Decimal.Value): string {
  return new Decimal(quantity).toString();
}
