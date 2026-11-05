import { Decimal } from "@prisma/client/runtime/index-browser";

// Whether a menu item can be ordered right now — one rule for the order
// screen (Part 3) and the digital menu (Part 8):
//
//   Currently unavailable   isAvailable is off (the kitchen's choice; wins)
//   Out of stock            with a recipe: an ingredient can't cover one
//                           serving (at zero, or below one serving's
//                           quantity); without one: its own stock is 0
//   Available               otherwise
//
// Stock is the warehouse the order (or the table's area) takes stock from.

export type MenuAvailability = "available" | "out_of_stock" | "unavailable";

export type AvailabilityInput = {
  isAvailable: boolean;
  // Its live recipe: per serving, with each ingredient's stock.
  recipe: readonly { quantity: Decimal.Value; stock: Decimal.Value }[];
  // Its own stock (used when it has no recipe).
  ownStock: Decimal.Value;
};

export function menuAvailability({ isAvailable, recipe, ownStock }: AvailabilityInput): MenuAvailability {
  if (!isAvailable) return "unavailable";
  const inStock = recipe.length
    ? recipe.every((line) => new Decimal(line.stock).greaterThanOrEqualTo(line.quantity))
    : new Decimal(ownStock).greaterThan(0);
  return inStock ? "available" : "out_of_stock";
}

// The short tag on a dish card (the designs' wording) and the longer one.
export const AVAILABILITY_TAG: Record<Exclude<MenuAvailability, "available">, { tag: string; title: string }> = {
  unavailable: { tag: "Unavailable", title: "Currently unavailable" },
  out_of_stock: { tag: "Out of stock", title: "Out of stock in this warehouse" },
};
