import type { OrderStatus, OrderType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { addDays, lastNDaysRange, todayInAppZone, todayRange, type DateRange } from "@/lib/dateRanges";
import { formatNaira } from "@/lib/format";
import { appDayBounds } from "./time";

// The Restaurant Dashboard's pure helpers: the date filter, the tiles'
// notes and the widgets' display rules. The numbers come from
// server/queries/dashboard.ts.

export const DASHBOARD_RANGES = { today: "Today", yesterday: "Yesterday", "7d": "Last 7 days" } as const;
export type DashboardRangeKey = keyof typeof DASHBOARD_RANGES;

export type DashboardPeriod = {
  key: DashboardRangeKey;
  // Inclusive calendar days (lib/dateRanges).
  range: DateRange;
  // The same days a week earlier: "the same weekday last week".
  previous: DateRange;
  // "last Thu", or "the previous 7 days".
  previousName: string;
  // "Revenue today" / "Revenue yesterday" / "Revenue · 7 days".
  revenueLabel: string;
  // The page subtitle's date: "Thu 29 Oct", or "23 – 29 Oct".
  dayText: string;
};

const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const fullDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

const isRangeKey = (value: unknown): value is DashboardRangeKey => typeof value === "string" && Object.hasOwn(DASHBOARD_RANGES, value);

// ?range= → the period (anything unknown means Today).
export function resolvePeriod(param: unknown, now: Date = new Date()): DashboardPeriod {
  const key = isRangeKey(param) ? param : "today";
  const today = todayInAppZone(now);
  const range = key === "today" ? todayRange(now) : key === "yesterday" ? { from: addDays(today, -1), to: addDays(today, -1) } : lastNDaysRange(7, now);
  const previous = { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  const single = range.from === range.to;
  return {
    key,
    range,
    previous,
    previousName: single ? `last ${weekday.format(asDate(range.from))}` : "the previous 7 days",
    revenueLabel: key === "today" ? "Revenue today" : key === "yesterday" ? "Revenue yesterday" : "Revenue · 7 days",
    dayText: single
      ? fullDay.format(asDate(range.from)).replace(",", "")
      : `${dayMonth.format(asDate(range.from))} – ${dayMonth.format(asDate(range.to))}`,
  };
}

// The period's days as instants, [start, end): from the first day's
// midnight to the end of the last day, on the app's clock.
export function periodBounds(range: DateRange): { start: Date; end: Date } {
  return { start: appDayBounds(range.from).start, end: appDayBounds(range.to).end };
}

// ---- Tile notes ------------------------------------------------------------

const vs = (previousName: string) => `vs ${previousName}`;
const sameAs = (previousName: string) => `Same as ${previousName}`;

// "+12% vs last Thu" (whole percent). From nothing it's the amount instead.
export function percentNote(current: Decimal.Value, previous: Decimal.Value, previousName: string): string {
  const now = new Decimal(current);
  const before = new Decimal(previous);
  if (now.equals(before)) return sameAs(previousName);
  if (before.isZero()) return `+${formatNaira(now.toFixed(2))} ${vs(previousName)}`;
  const percent = now.minus(before).div(before).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return `${percent.isNegative() ? "−" : "+"}${percent.abs().toString()}% ${vs(previousName)}`;
}

// "+₦3.10 vs last Thu".
export function moneyDeltaNote(current: Decimal.Value, previous: Decimal.Value, previousName: string): string {
  const delta = new Decimal(current).minus(previous);
  if (delta.isZero()) return sameAs(previousName);
  return `${delta.isNegative() ? "−" : "+"}${formatNaira(delta.abs().toFixed(2))} ${vs(previousName)}`;
}

// "+8 vs last Thu".
export function countDeltaNote(current: number, previous: number, previousName: string): string {
  const delta = current - previous;
  if (delta === 0) return sameAs(previousName);
  return `${delta < 0 ? "−" : "+"}${Math.abs(delta)} ${vs(previousName)}`;
}

// Revenue ÷ bills, 2dp (₦0.00 with no bills).
export function averageBill(revenue: Decimal.Value, bills: number): string {
  return bills === 0 ? "0.00" : new Decimal(revenue).div(bills).toFixed(2, Decimal.ROUND_HALF_UP);
}

// The design's prep-time target (there's no setting for it yet).
export const PREP_TARGET_MINUTES = 15;

// 860 → "14m 20s"; no dishes ready yet → "0m 00s".
export function formatPrepTime(seconds: number | null): string {
  const whole = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

// "35% of floor".
export function floorShare(occupied: number, total: number): string {
  return total === 0 ? "No tables yet" : `${Math.round((occupied / total) * 100)}% of floor`;
}

// ---- Sales by hour ---------------------------------------------------------

// The design's chart runs 10:00–23:00; hours with sales outside that widen it.
const FIRST_HOUR = 10;
const LAST_HOUR = 23;

export type HourBar = { hour: number; label: string; total: string; pct: number; peak: boolean };
export type HourChart = { bars: HourBar[]; peak: { label: string; total: string } | null };

export function hourChart(rows: readonly { hour: number; total: string }[]): HourChart {
  const byHour = new Map(rows.map((row) => [row.hour, new Decimal(row.total)]));
  const withSales = rows.filter((row) => !new Decimal(row.total).isZero()).map((row) => row.hour);
  const first = Math.min(FIRST_HOUR, ...withSales);
  const last = Math.max(LAST_HOUR, ...withSales);

  let peakHour: number | null = null;
  for (const [hour, total] of byHour) {
    if (total.isZero()) continue;
    const best = peakHour === null ? null : byHour.get(peakHour)!;
    if (best === null || total.greaterThan(best) || (total.equals(best) && hour < peakHour!)) peakHour = hour;
  }
  const max = peakHour === null ? null : byHour.get(peakHour)!;

  const bars: HourBar[] = [];
  for (let hour = first; hour <= last; hour++) {
    const total = byHour.get(hour) ?? new Decimal(0);
    bars.push({
      hour,
      label: String(hour).padStart(2, "0"),
      total: total.toFixed(2),
      pct: max ? total.div(max).times(100).toDecimalPlaces(1).toNumber() : 0,
      peak: hour === peakHour,
    });
  }
  return { bars, peak: peakHour === null ? null : { label: `${String(peakHour).padStart(2, "0")}:00`, total: max!.toFixed(2) } };
}

// ---- Lists -----------------------------------------------------------------

export const ORDER_TYPES: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "DELIVERY"];

// Live open orders: what the order is waiting on.
export const OPEN_ORDER_STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  OPEN: "Ordering",
  SENT: "In kitchen",
  SERVED: "Served · ready to bill",
};

// An order open longer than this shows its time in red.
export const LATE_ORDER_MINUTES = 45;

// The badge for an order with no table.
export const NO_TABLE_BADGE: Record<OrderType, string> = { DINE_IN: "—", TAKEAWAY: "TA", DELIVERY: "DL" };

// Low-stock ingredients (at or below the alert level, as the retail
// dashboard's stock alerts): Critical at half the alert level or less.
export type StockLevel = "Critical" | "Low";
export function stockLevel(quantity: number, alert: number): StockLevel {
  return quantity * 2 <= alert ? "Critical" : "Low";
}

// ---- Waste -------------------------------------------------------------------

// The Waste tile's label for the period.
export const WASTE_LABEL: Record<DashboardRangeKey, string> = { today: "Waste today", yesterday: "Waste yesterday", "7d": "Waste · 7 days" };

// Food cost: what the period's billed lines took from stock, at each
// product's cost — a line's stockPerUnit (written at settle: its
// ingredients by the recipe then, or the dish itself) × its quantity. A
// product with no cost counts as ₦0; a line without stockPerUnit (settled
// before it was recorded) adds nothing.
export function foodCostOf(lines: readonly { quantity: number; stockPerUnit: unknown }[], costOf: ReadonlyMap<string, Decimal.Value>): Decimal {
  let total = new Decimal(0);
  for (const line of lines) {
    if (!Array.isArray(line.stockPerUnit)) continue;
    for (const move of line.stockPerUnit as { productId?: unknown; quantity?: unknown }[]) {
      if (typeof move?.productId !== "string") continue;
      const quantity = new Decimal(String(move.quantity ?? 0)).times(line.quantity);
      total = total.plus(quantity.times(costOf.get(move.productId) ?? 0));
    }
  }
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// The waste's share of the food cost (%, 1 decimal); null with no food cost.
export function wasteShare(waste: Decimal.Value, foodCost: Decimal.Value): number | null {
  const base = new Decimal(foodCost);
  if (!base.greaterThan(0)) return null;
  return new Decimal(waste).div(base).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

// The tile's colour: amber above the amber %, red above the red % (both
// settings). No food cost: amber if anything was wasted, else ok.
export type WasteLevel = "ok" | "amber" | "red";
export function wasteLevel(share: number | null, waste: Decimal.Value, amberPercent: Decimal.Value, redPercent: Decimal.Value): WasteLevel {
  if (share === null) return new Decimal(waste).greaterThan(0) ? "amber" : "ok";
  if (new Decimal(share).greaterThan(redPercent)) return "red";
  if (new Decimal(share).greaterThan(amberPercent)) return "amber";
  return "ok";
}

// "3.2% of food cost (₦1,200.00)", or why there's no share.
export function wasteShareNote(share: number | null, foodCost: Decimal.Value, entries: number): string {
  if (share !== null) return `${share}% of food cost (${formatNaira(new Decimal(foodCost).toFixed(2))})`;
  return entries === 0 ? "Nothing wasted" : "No food cost billed yet";
}
