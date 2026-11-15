import type { OrderType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { eachDay, type DateRange } from "@/lib/dateRanges";

// Restaurant Reports › Overview, put together from what the database added
// up (server/queries/reports/overview.ts) — already-grouped rows, never one
// per order. Pure, so it's unit tested.
//
//   Net sales  the settled bills' Sale totals (what the retail Sales report
//              shows: after discounts, with service charge and tax; never
//              tips) − refunds made in the period (by when they happened,
//              whichever period the bill was in).
//   Food cost  the sold lines' cost at settle (OrderItem.unitCost); lines
//              with no cost are left out and counted.

export type SalesRow = { day: string; hour: number; type: OrderType; orders: number; covers: number; sales: Decimal.Value };
export type RefundRow = { day: string; hour: number; type: OrderType; refunds: Decimal.Value };
export type CostSum = { cost: Decimal.Value; quantity: number; missingQuantity: number };

export type OverviewTotals = {
  orders: number;
  covers: number;
  // The bills as settled (before refunds).
  sales: Decimal;
  refunds: Decimal;
  net: Decimal;
  tips: Decimal;
  waste: Decimal;
  wasteEntries: number;
  // Null without View Cost (not worked out at all).
  cost: { total: Decimal; quantity: number; missingQuantity: number } | null;
};

const sum = (values: Iterable<Decimal.Value>) => {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(value);
  return total;
};

export function totalsOf(input: { sales: readonly SalesRow[]; refunds: readonly RefundRow[]; tips: Decimal.Value; waste: Decimal.Value; wasteEntries: number; cost: CostSum | null }): OverviewTotals {
  const sales = sum(input.sales.map((r) => r.sales));
  const refunds = sum(input.refunds.map((r) => r.refunds));
  return {
    orders: input.sales.reduce((n, r) => n + r.orders, 0),
    covers: input.sales.reduce((n, r) => n + r.covers, 0),
    sales,
    refunds,
    net: sales.minus(refunds),
    tips: new Decimal(input.tips),
    waste: new Decimal(input.waste),
    wasteEntries: input.wasteEntries,
    cost: input.cost ? { total: new Decimal(input.cost.cost), quantity: input.cost.quantity, missingQuantity: input.cost.missingQuantity } : null,
  };
}

// Net sales by a key: bills by when they closed, minus refunds by when they
// happened. Every key's figures add up to the Net sales tile.
function netBy<K>(sales: readonly SalesRow[], refunds: readonly RefundRow[], key: (row: SalesRow | RefundRow) => K): Map<K, Decimal> {
  const totals = new Map<K, Decimal>();
  const add = (k: K, amount: Decimal.Value) => totals.set(k, (totals.get(k) ?? new Decimal(0)).plus(amount));
  for (const row of sales) add(key(row), row.sales);
  for (const row of refunds) add(key(row), new Decimal(row.refunds).negated());
  return totals;
}

// Every hour that had anything (the dashboard's hour chart fills the rest).
export function netByHour(sales: readonly SalesRow[], refunds: readonly RefundRow[]): { hour: number; total: string }[] {
  return [...netBy(sales, refunds, (r) => r.hour)].sort(([a], [b]) => a - b).map(([hour, total]) => ({ hour, total: total.toFixed(2) }));
}

// Every day of the period, in order (0 on a quiet day).
export function netByDay(range: DateRange, sales: readonly SalesRow[], refunds: readonly RefundRow[]): { day: string; total: string }[] {
  const byDay = netBy(sales, refunds, (r) => r.day);
  return eachDay(range).map((day) => ({ day, total: (byDay.get(day) ?? new Decimal(0)).toFixed(2) }));
}

export const OVERVIEW_ORDER_TYPES: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "BAR_TAB", "DELIVERY"];

// Each order type: its orders and net sales (types with neither left out).
export function netByType(sales: readonly SalesRow[], refunds: readonly RefundRow[]): { type: OrderType; orders: number; net: string }[] {
  const net = netBy(sales, refunds, (r) => r.type);
  return OVERVIEW_ORDER_TYPES.map((type) => ({ type, orders: sales.filter((r) => r.type === type).reduce((n, r) => n + r.orders, 0), net: (net.get(type) ?? new Decimal(0)).toFixed(2) })).filter(
    (row) => row.orders > 0 || !new Decimal(row.net).isZero(),
  );
}

export type DepartmentKey = "FOOD" | "BAR" | "NONE";
export const DEPARTMENT_LABEL: Record<DepartmentKey, string> = { FOOD: "Food", BAR: "Bar", NONE: "Not on a menu button" };

// Item sales by department (Part 6e: the item's button group), less items
// refunded in the period. Item sales: the bill's lines, before the
// bill-level discount and service charge.
export function netByDepartment(sold: readonly { department: DepartmentKey; amount: Decimal.Value }[], returned: readonly { department: DepartmentKey; amount: Decimal.Value }[]): { department: DepartmentKey; net: string }[] {
  const totals = new Map<DepartmentKey, Decimal>();
  for (const row of sold) totals.set(row.department, (totals.get(row.department) ?? new Decimal(0)).plus(row.amount));
  for (const row of returned) totals.set(row.department, (totals.get(row.department) ?? new Decimal(0)).minus(row.amount));
  return (["FOOD", "BAR", "NONE"] as const).filter((d) => totals.has(d) && !totals.get(d)!.isZero()).map((department) => ({ department, net: totals.get(department)!.toFixed(2) }));
}

// The best day: the most net sales (the earliest on a tie); none if nothing sold.
export function bestDayOf(days: readonly { day: string; total: string }[]): { day: string; total: string } | null {
  let best: { day: string; total: string } | null = null;
  for (const d of days) if (new Decimal(d.total).greaterThan(best ? best.total : 0)) best = d;
  return best;
}

// Food cost % = cost of sold items ÷ net sales (1 decimal); null when there
// are no net sales.
export function foodCostPercent(cost: Decimal.Value, net: Decimal.Value): number | null {
  const base = new Decimal(net);
  if (!base.greaterThan(0)) return null;
  return new Decimal(cost).div(base).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

// "+1.4 pts vs …" for a percentage tile.
export function pointsNote(current: number | null, previous: number | null, previousName: string): string {
  if (current === null) return "No net sales to compare with";
  if (previous === null) return `Nothing to compare with in the ${previousName}`;
  const delta = new Decimal(current).minus(previous).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  if (delta.isZero()) return `Same as the ${previousName}`;
  return `${delta.isNegative() ? "−" : "+"}${delta.abs().toFixed(1)} pts vs the ${previousName}`;
}

// What the KPI notes compare with: "previous day", "previous 7 days".
export const previousName = (days: number) => (days === 1 ? "previous day" : `previous ${days} days`);

// An amount per cover, 2dp (0.00 with no covers). The tiles use the bills
// as settled, like Average bill.
export function perCover(amount: Decimal.Value, covers: number): string {
  return covers === 0 ? "0.00" : new Decimal(amount).div(covers).toFixed(2, Decimal.ROUND_HALF_UP);
}
