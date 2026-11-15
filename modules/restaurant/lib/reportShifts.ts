import { Decimal } from "@prisma/client/runtime/index-browser";
import { expectedCash, variance as varianceOf } from "./cashUp";

// Restaurant Reports › Shifts & cash-up (Step 9), put together from the rows
// the database found (server/queries/reports/shifts.ts). Pure.
//
//   Hours      clock in → clock out (an open shift: up to now)
//   Net sales  the bills they settled while on shift, less refunds made then
//   Expected   float + cash sales + cash tips − cash refunds (the cash-up's
//              own rule, lib/cashUp.ts); variance = counted − expected
//   Red        a variance, over or short, of more than the limit

export type ShiftRow = {
  id: string;
  userId: string;
  name: string;
  role: string | null;
  startedAt: Date;
  endedAt: Date | null;
  // Closed when their next shift started (not ended by them).
  autoEnded: boolean;
  orders: number;
  sales: Decimal.Value;
  refunds: Decimal.Value;
  // Open tables they handed over at the end, and to whom.
  handedOver: number;
  handedTo: string | null;
};

export type TillRow = {
  id: string;
  deviceId: string;
  device: string;
  openedBy: string;
  closedBy: string | null;
  openedAt: Date;
  closedAt: Date | null;
  float: Decimal.Value;
  cashSales: Decimal.Value;
  cashTips: Decimal.Value;
  cashRefunds: Decimal.Value;
  drawerOpens: number;
  drawerByHand: number;
  counted: Decimal.Value | null;
  storedExpected: Decimal.Value | null;
  storedVariance: Decimal.Value | null;
  zPrinted: boolean;
};

export type ShiftLine = ShiftRow & { seconds: number; net: string };

export function shiftLines(rows: readonly ShiftRow[], now: Date = new Date()): { lines: ShiftLine[]; totals: { shifts: number; seconds: number; orders: number; net: string; handedOver: number } } {
  const lines = rows.map((r) => ({
    ...r,
    seconds: Math.max(0, Math.round(((r.endedAt ?? now).getTime() - r.startedAt.getTime()) / 1000)),
    net: new Decimal(r.sales).minus(r.refunds).toFixed(2),
  }));
  return {
    lines,
    totals: {
      shifts: lines.length,
      seconds: lines.reduce((n, l) => n + l.seconds, 0),
      orders: lines.reduce((n, l) => n + l.orders, 0),
      net: lines.reduce((t, l) => t.plus(l.net), new Decimal(0)).toFixed(2),
      handedOver: lines.reduce((n, l) => n + l.handedOver, 0),
    },
  };
}

export type TillLine = TillRow & { open: boolean; expected: string; variance: string | null; overLimit: boolean };

export function tillLines(rows: readonly TillRow[], limit: Decimal.Value): { lines: TillLine[]; totals: { tills: number; cashSales: string; cashRefunds: string; drawerOpens: number; variance: string; overLimit: number } } {
  const lines = rows.map((r) => {
    const expected = r.storedExpected !== null ? new Decimal(r.storedExpected) : expectedCash({ float: r.float, cashSales: r.cashSales, cashTips: r.cashTips, cashRefunds: r.cashRefunds });
    const variance = r.storedVariance !== null ? new Decimal(r.storedVariance) : r.counted !== null ? varianceOf(r.counted, expected) : null;
    return { ...r, open: r.closedAt === null, expected: expected.toFixed(2), variance: variance === null ? null : variance.toFixed(2), overLimit: variance !== null && variance.abs().greaterThan(limit) };
  });
  const sum = (pick: (l: TillLine) => Decimal.Value | null) => lines.reduce((t, l) => t.plus(pick(l) ?? 0), new Decimal(0)).toFixed(2);
  return {
    lines,
    totals: {
      tills: lines.length,
      cashSales: sum((l) => l.cashSales),
      cashRefunds: sum((l) => l.cashRefunds),
      drawerOpens: lines.reduce((n, l) => n + l.drawerOpens, 0),
      variance: sum((l) => l.variance),
      overLimit: lines.filter((l) => l.overLimit).length,
    },
  };
}

// "+₦12.50 over", "−₦300.00 short", "Balanced".
export function varianceText(variance: string | null, money: (v: string) => string): string {
  if (variance === null) return "—";
  const v = new Decimal(variance);
  if (v.isZero()) return "Balanced";
  return v.isPositive() ? `${money(v.toFixed(2))} over` : `${money(v.abs().toFixed(2))} short`;
}
