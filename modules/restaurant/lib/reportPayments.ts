import type { PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";

// Restaurant Reports › Payments & tips (Step 6), put together from what the
// database added up (server/queries/reports/payments.ts). Pure.
//
//   By method  the period's settled bills' Sale payments — a split bill's
//              every part, each by its own method; exactly what was due
//              (change stays out, and so do tips)
//   Tips       kept apart from sales: by waiter, by method
//   Refunds    each one made in the period, whichever period its bill was in

export const PAYMENT_METHODS: readonly PaymentType[] = ["CASH", "CARD", "BANK_TRANSFER", "CHEQUE"];

export type CountAmount = { count: number; amount: Decimal.Value };
export type MethodLine = { method: PaymentType; count: number; amount: string; share: number | null };

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

// Every method, always (0 when unused); the share of the total amount.
export function methodLines(rows: readonly (CountAmount & { method: PaymentType })[]): { lines: MethodLine[]; totals: { count: number; amount: string } } {
  const total = rows.reduce((t, r) => t.plus(r.amount), ZERO);
  const lines = PAYMENT_METHODS.map((method) => {
    const r = rows.find((x) => x.method === method);
    const amount = new Decimal(r?.amount ?? 0);
    return { method, count: r?.count ?? 0, amount: money(amount), share: total.greaterThan(0) ? amount.div(total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : null };
  });
  return { lines, totals: { count: rows.reduce((n, r) => n + r.count, 0), amount: money(total) } };
}

export type TipWaiterLine = { userId: string; name: string; count: number; amount: string };

export function tipLines(byWaiter: readonly (CountAmount & { userId: string })[], names: ReadonlyMap<string, string>): { lines: TipWaiterLine[]; totals: { count: number; amount: string } } {
  return {
    lines: byWaiter.map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? "Deleted user", count: r.count, amount: money(new Decimal(r.amount)) })),
    totals: { count: byWaiter.reduce((n, r) => n + r.count, 0), amount: money(byWaiter.reduce((t, r) => t.plus(r.amount), ZERO)) },
  };
}

export type RefundRow = {
  id: string;
  reference: string;
  at: Date;
  sale: string;
  orderNumber: number;
  amount: Decimal.Value;
  methods: PaymentType[];
  by: string | null;
  // Restaurant refunds say (OrderRefund.returnedToStock); a Sales › Returns
  // one put stock back when Received or Completed.
  toStock: boolean;
};

export function refundTotals(rows: readonly RefundRow[]): { count: number; amount: string; toStock: number } {
  return { count: rows.length, amount: money(rows.reduce((t, r) => t.plus(r.amount), ZERO)), toStock: rows.filter((r) => r.toStock).length };
}
