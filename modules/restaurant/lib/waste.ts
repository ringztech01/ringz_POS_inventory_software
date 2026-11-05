import type { ProductType, WasteReason, WasteStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { addDays, todayRange, type DateRange } from "@/lib/dateRanges";
import { sumSubtotals } from "@/lib/pricing";
import { resolveStockLines } from "./resolveStockLines";
import { isCalendarDay } from "./time";

// What wasting an item takes out of stock, and what that cost:
//
//   a menu item with a recipe   its ingredients (resolveStockLines — the
//                               recipe × the quantity)
//   a menu item without one,    itself
//   or a raw ingredient
//
// Each line's unit cost is the product's cost now (none set: ₦0); its line
// cost is unit cost × quantity to the kobo; the total is their sum. The
// entry keeps all of it as logged — it's never worked out again. Stock is
// counted in whole units, so every line has to come out whole (a recipe in
// part units, or half of something without one, is refused).

export const WASTE_REASON_LABEL: Record<WasteReason, string> = {
  BURNT: "Burnt",
  EXPIRED: "Expired",
  DROPPED: "Dropped",
  RETURNED_BY_GUEST: "Returned by guest",
  OVERPRODUCTION: "Overproduction",
  OTHER: "Other",
};

export type WasteItem = {
  id: string;
  name: string;
  productType: ProductType;
  cost: Decimal.Value | null;
  // Live recipe lines with each ingredient's cost now (MENU_ITEMs only).
  recipe: readonly { ingredientId: string; ingredientName: string; quantity: Decimal.Value; cost: Decimal.Value | null }[];
};

export type WasteLine = { productId: string; productName: string; qty: Decimal; unitCost: Decimal; lineCost: Decimal };
export type WastePlan = { ok: true; lines: WasteLine[]; total: Decimal } | { ok: false; error: string };

export function planWaste(item: WasteItem, qty: Decimal.Value): WastePlan {
  if (item.productType !== "MENU_ITEM" && item.productType !== "INGREDIENT") return { ok: false, error: "Only menu items and ingredients are logged as waste." };
  const amount = new Decimal(qty);
  if (!amount.greaterThan(0)) return { ok: false, error: "The quantity must be more than 0." };

  const moves = resolveStockLines([
    {
      productId: item.id,
      productName: item.name,
      productType: item.productType,
      quantity: amount,
      recipe: item.recipe.map((r) => ({ ingredientId: r.ingredientId, ingredientName: r.ingredientName, quantity: r.quantity })),
    },
  ]);
  const costOf = new Map<string, Decimal>([[item.id, new Decimal(item.cost ?? 0)], ...item.recipe.map((r) => [r.ingredientId, new Decimal(r.cost ?? 0)] as const)]);

  const lines: WasteLine[] = [];
  for (const move of moves) {
    if (!move.quantity.isInteger()) {
      return {
        ok: false,
        error:
          move.productId === item.id
            ? `${item.name} is counted in whole units — waste a whole number of them.`
            : `${move.productName}: that comes to part of a unit (${move.quantity.toString()}). Recipes take whole units — fix it in Food › Recipes, or waste a whole number of ${item.name}.`,
      };
    }
    const unitCost = costOf.get(move.productId) ?? new Decimal(0);
    lines.push({ productId: move.productId, productName: move.productName, qty: move.quantity, unitCost, lineCost: unitCost.times(move.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) });
  }
  if (lines.length === 0) return { ok: false, error: "Nothing would come out of stock." };
  return { ok: true, lines, total: sumSubtotals(lines.map((line) => line.lineCost)) };
}

// ---- Food › Waste (the list)

export const WASTE_STATUS_LABEL: Record<WasteStatus, string> = { ACTIVE: "Active", VOID: "Voided" };

export type WasteFilter = {
  range: DateRange;
  reason: WasteReason | null;
  // Logged by.
  userId: string | null;
  status: WasteStatus | null;
  q: string;
};

const REASONS = Object.keys(WASTE_REASON_LABEL) as WasteReason[];
const STATUSES = Object.keys(WASTE_STATUS_LABEL) as WasteStatus[];

// The list's filters from the URL: ?from&to (calendar days, default today;
// swapped if backwards; at most a year), ?reason and ?status (known values,
// else all), ?user (someone in the Logged by list, else everyone) and ?q
// (the item's name or code).
export function readWasteFilter(
  params: { from?: string; to?: string; reason?: string; user?: string; status?: string; q?: string },
  userIds: readonly string[],
  now: Date = new Date(),
): WasteFilter {
  const fallback = todayRange(now);
  let from = isCalendarDay(params.from) ? params.from : isCalendarDay(params.to) ? params.to : fallback.from;
  let to = isCalendarDay(params.to) ? params.to : isCalendarDay(params.from) ? params.from : fallback.to;
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -366)) from = addDays(to, -366);
  return {
    range: { from, to },
    reason: REASONS.find((r) => r === params.reason) ?? null,
    userId: params.user && userIds.includes(params.user) ? params.user : null,
    status: STATUSES.find((s) => s === params.status) ?? null,
    q: params.q?.trim().slice(0, 100) ?? "",
  };
}

export type WasteReasonTotal = { reason: WasteReason; cost: Decimal.Value; count: number };

// The summary strip: the period's waste (voided entries left out) — its
// cost, how many entries, and the reason that cost the most (ties: the more
// entries, then the reasons' order). No waste: no top reason.
export function summarizeWaste(byReason: readonly WasteReasonTotal[]): { total: Decimal; count: number; topReason: WasteReason | null } {
  const rows = byReason.map((r) => ({ ...r, cost: new Decimal(r.cost) })).filter((r) => r.count > 0);
  const top = [...rows].sort((a, b) => b.cost.comparedTo(a.cost) || b.count - a.count || REASONS.indexOf(a.reason) - REASONS.indexOf(b.reason))[0];
  return { total: sumSubtotals(rows.map((r) => r.cost)), count: rows.reduce((n, r) => n + r.count, 0), topReason: top?.reason ?? null };
}
