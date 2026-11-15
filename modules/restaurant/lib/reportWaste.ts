import type { WasteReason } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { eachDay, type DateRange } from "@/lib/dateRanges";
import { wasteLevel, wasteShare, type WasteLevel } from "./dashboard";
import { summarizeWaste } from "./waste";

// Restaurant Reports › Waste (Step 7), put together from what the database
// added up (server/queries/reports/waste.ts). Pure. The strip and its
// colours are the dashboard's (Part 6b): waste as a share of food cost,
// amber and red past the business's two settings.

export type WasteKpis = {
  total: string;
  entries: number;
  topReason: WasteReason | null;
  // Null without View Cost (food cost isn't worked out), or no food cost.
  share: number | null;
  level: WasteLevel | null;
};

export function wasteKpis(input: { byReason: readonly { reason: WasteReason; count: number; cost: Decimal.Value }[]; foodCost: Decimal.Value | null; amber: Decimal.Value; red: Decimal.Value }): WasteKpis {
  const s = summarizeWaste(input.byReason);
  const share = input.foodCost === null ? null : wasteShare(s.total, input.foodCost);
  return {
    total: s.total.toFixed(2),
    entries: s.count,
    topReason: s.topReason,
    share,
    level: input.foodCost === null ? null : wasteLevel(share, s.total, input.amber, input.red),
  };
}

// Each row's share of all the period's waste (1 decimal).
export function withShares<T extends { cost: Decimal.Value }>(rows: readonly T[]): (T & { share: number | null })[] {
  const total = rows.reduce((t, r) => t.plus(r.cost), new Decimal(0));
  return rows.map((r) => ({ ...r, share: total.greaterThan(0) ? new Decimal(r.cost).div(total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : null }));
}

// Every day of the period (0 on a day with none).
export function wasteByDay(range: DateRange, rows: readonly { day: string; cost: Decimal.Value }[]): { day: string; total: string }[] {
  const by = new Map(rows.map((r) => [r.day, new Decimal(r.cost)]));
  return eachDay(range).map((day) => ({ day, total: (by.get(day) ?? new Decimal(0)).toFixed(2) }));
}

// Food › Waste with the matching filters: the period's days, and a reason,
// a person or an item.
export function wasteHref(range: DateRange, filter: { reason?: WasteReason; user?: string; q?: string } = {}): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (filter.reason) params.set("reason", filter.reason);
  if (filter.user) params.set("user", filter.user);
  if (filter.q) params.set("q", filter.q);
  return `/restaurant/food/waste?${params.toString()}`;
}

// "2.5 kg", "3 pc" — the quantity without trailing zeros.
export const formatQuantity = (qty: Decimal.Value, unit: string) => `${new Decimal(qty).toDecimalPlaces(3).toString()}${unit ? ` ${unit}` : ""}`;
