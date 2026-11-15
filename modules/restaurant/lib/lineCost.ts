import { Decimal } from "@prisma/client/runtime/index-browser";
import { resolveStockLines, type SoldLine } from "./resolveStockLines";

// What one of a sold line cost, worked out at settle (OrderItem.unitCost,
// Restaurant Reports' food cost): what one of it takes from stock — the
// recipe's ingredients, or the item itself (resolveStockLines, the same as
// the stock taken) — times each product's cost then. Null when any of those
// has no cost: the line is left out of food cost and counted in the
// "some items had no cost" note. A cost of 0 is a cost.
export function unitCostOf(line: Omit<SoldLine, "quantity">, costOf: ReadonlyMap<string, Decimal.Value | null>): Decimal | null {
  let total = new Decimal(0);
  for (const move of resolveStockLines([{ ...line, quantity: 1 }])) {
    const cost = costOf.get(move.productId);
    if (cost === null || cost === undefined) return null;
    total = total.plus(move.quantity.times(cost));
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}
