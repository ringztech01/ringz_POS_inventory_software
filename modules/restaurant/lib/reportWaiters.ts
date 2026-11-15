import { Decimal } from "@prisma/client/runtime/index-browser";

// Restaurant Reports › By waiter (Step 4), put together from what the
// database added up per person (server/queries/reports/waiters.ts). Pure.
//
//   Orders, covers, net sales, average bill, table time — the settled
//     orders they waited (net: the bills less refunds made in the period)
//   Tips — their tips on those orders
//   Discounts given — bills they put a discount on (count, amount)
//   Voids — sent lines they voided in the period (count, value)
//   Manager overrides — times a manager's PIN approved something for them
//   Hours on shift — their clock-in / clock-out time in the period (Part 6f)
//   Sales per hour — net sales ÷ hours on shift

export type WaiterOrderRow = { userId: string | null; orders: number; covers: number; sales: Decimal.Value; tableSeconds: number };
export type WaiterAmountRow = { userId: string | null; amount: Decimal.Value };
export type WaiterCountRow = { userId: string | null; count: number; amount: Decimal.Value };
export type WaiterShiftRow = { userId: string; seconds: number };

export type WaiterLine = {
  // null: orders with no waiter.
  userId: string | null;
  name: string;
  orders: number;
  covers: number;
  net: string;
  averageBill: string | null;
  tips: string;
  discounts: number;
  discountAmount: string;
  voids: number;
  voidValue: string;
  overrides: number;
  // Seconds, opened → closed, on average (null: no orders).
  averageTableSeconds: number | null;
  // null: no shift recorded in the period.
  shiftSeconds: number | null;
  salesPerHour: string | null;
};

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const key = (id: string | null) => id ?? "";

export function waiterLines(input: {
  orders: readonly WaiterOrderRow[];
  refunds: readonly WaiterAmountRow[];
  tips: readonly WaiterAmountRow[];
  discounts: readonly WaiterCountRow[];
  voids: readonly WaiterCountRow[];
  overrides: readonly { userId: string; count: number }[];
  shifts: readonly WaiterShiftRow[];
  names: ReadonlyMap<string, string>;
}): { lines: WaiterLine[]; totals: WaiterLine } {
  const ids = new Set<string>([...input.orders, ...input.refunds, ...input.tips, ...input.discounts, ...input.voids, ...input.overrides].map((r) => key(r.userId)));
  const orders = new Map(input.orders.map((r) => [key(r.userId), r]));
  const amount = (rows: readonly WaiterAmountRow[]) => new Map(rows.map((r) => [key(r.userId), new Decimal(r.amount)]));
  const counted = (rows: readonly WaiterCountRow[]) => new Map(rows.map((r) => [key(r.userId), r]));
  const refunds = amount(input.refunds);
  const tips = amount(input.tips);
  const discounts = counted(input.discounts);
  const voids = counted(input.voids);
  const overrides = new Map(input.overrides.map((r) => [r.userId, r.count]));
  const shifts = new Map(input.shifts.map((r) => [r.userId, r.seconds]));

  const line = (id: string): { line: WaiterLine; sales: Decimal; tableTotal: number } => {
    const o = orders.get(id);
    const sales = new Decimal(o?.sales ?? 0);
    const net = sales.minus(refunds.get(id) ?? ZERO);
    const shiftSeconds = id && shifts.has(id) ? shifts.get(id)! : null;
    const out: WaiterLine = {
      userId: id || null,
      name: id ? (input.names.get(id) ?? "Deleted user") : "No waiter",
      orders: o?.orders ?? 0,
      covers: o?.covers ?? 0,
      net: money(net),
      averageBill: o && o.orders > 0 ? money(sales.div(o.orders)) : null,
      tips: money(tips.get(id) ?? ZERO),
      discounts: discounts.get(id)?.count ?? 0,
      discountAmount: money(new Decimal(discounts.get(id)?.amount ?? 0)),
      voids: voids.get(id)?.count ?? 0,
      voidValue: money(new Decimal(voids.get(id)?.amount ?? 0)),
      overrides: id ? (overrides.get(id) ?? 0) : 0,
      averageTableSeconds: o && o.orders > 0 ? Math.round(o.tableSeconds / o.orders) : null,
      shiftSeconds,
      salesPerHour: shiftSeconds ? money(net.div(shiftSeconds).times(3600)) : null,
    };
    return { line: out, sales, tableTotal: o?.tableSeconds ?? 0 };
  };

  const all = [...ids].map(line);
  const lines = all.map((a) => a.line);
  const sum = (pick: (l: WaiterLine) => Decimal.Value) => lines.reduce((t, l) => t.plus(pick(l)), ZERO);
  const ordersTotal = lines.reduce((n, l) => n + l.orders, 0);
  const shiftTotal = lines.reduce((n, l) => n + (l.shiftSeconds ?? 0), 0);
  const netTotal = sum((l) => l.net);
  const totals: WaiterLine = {
    userId: null,
    name: "Total",
    orders: ordersTotal,
    covers: lines.reduce((n, l) => n + l.covers, 0),
    net: money(netTotal),
    averageBill: ordersTotal > 0 ? money(all.reduce((t, a) => t.plus(a.sales), ZERO).div(ordersTotal)) : null,
    tips: money(sum((l) => l.tips)),
    discounts: lines.reduce((n, l) => n + l.discounts, 0),
    discountAmount: money(sum((l) => l.discountAmount)),
    voids: lines.reduce((n, l) => n + l.voids, 0),
    voidValue: money(sum((l) => l.voidValue)),
    overrides: lines.reduce((n, l) => n + l.overrides, 0),
    averageTableSeconds: ordersTotal > 0 ? Math.round(all.reduce((n, a) => n + a.tableTotal, 0) / ordersTotal) : null,
    shiftSeconds: shiftTotal > 0 ? shiftTotal : null,
    // Only the net of those with shifts, over their hours.
    salesPerHour: shiftTotal > 0 ? money(lines.filter((l) => l.shiftSeconds).reduce((t, l) => t.plus(l.net), ZERO).div(shiftTotal).times(3600)) : null,
  };
  return { lines, totals };
}

// 4500 → "1.3 h" (hours, 1 decimal).
export const formatHours = (seconds: number) => `${(Math.round((seconds / 3600) * 10) / 10).toFixed(1)} h`;
