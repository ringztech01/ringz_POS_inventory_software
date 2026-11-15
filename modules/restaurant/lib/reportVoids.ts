import type { OrderDiscountType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import type { DateRange } from "@/lib/dateRanges";

// Restaurant Reports › Voids & discounts (Step 8), put together from the
// rows the database found (server/queries/reports/voids.ts). Pure.
//
//   Voids      sent lines voided in the period (any order but a training
//              one), with who approved it when a manager's PIN was needed
//              (Part 6f: the override logged against the line)
//   Discounts  the period's settled bills with a discount: what was asked
//              (10% or ₦5), what the bill took off (its Sale's discount),
//              who put it on, who approved it
// Highlighted: a void that needed a manager's PIN; a discount over the
// business's limit (its share of the bill's items).

export type VoidRow = {
  id: string;
  at: Date;
  orderId: string;
  orderNumber: number;
  table: string | null;
  item: string;
  quantity: number;
  value: Decimal.Value;
  waiter: string | null;
  voidedBy: string | null;
  voidedById: string | null;
  // As written on the line ("Wrong item · approved by Mona").
  reason: string | null;
  approvedBy: string | null;
};

export type DiscountRow = {
  orderId: string;
  orderNumber: number;
  at: Date;
  type: OrderDiscountType;
  value: Decimal.Value;
  amount: Decimal.Value;
  // The bill's items before the discount.
  items: Decimal.Value;
  reason: string | null;
  appliedBy: string | null;
  appliedById: string | null;
  approvedBy: string | null;
};

// "Wrong item · approved by Mona" → "Wrong item" (the approver has its own column).
export const voidReason = (reason: string | null) => (reason ? reason.replace(/ · approved by .*$/, "") : null);

// The discount as a share of the bill's items (1 decimal).
export function discountShare(amount: Decimal.Value, items: Decimal.Value): number | null {
  const base = new Decimal(items);
  if (!base.greaterThan(0)) return null;
  return new Decimal(amount).div(base).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

// Over the limit: more than the limit's share of the bill.
export const overLimit = (share: number | null, limitPercent: Decimal.Value) => share !== null && new Decimal(share).greaterThan(limitPercent);

// "10%" or "₦5.00" — what was asked for.
export const discountAsked = (type: OrderDiscountType, value: Decimal.Value) => (type === "PERCENT" ? `${new Decimal(value).toDecimalPlaces(2).toString()}%` : `₦${new Decimal(value).toFixed(2)}`);

export type VoidsTotals = { voids: number; voidValue: string; voidsApproved: number; discounts: number; discountAmount: string; discountsApproved: number; overLimit: number };

export function voidsTotals(input: { voids: { count: number; value: Decimal.Value; approved: number }; discounts: { count: number; amount: Decimal.Value; approved: number }; overLimit: number }): VoidsTotals {
  return {
    voids: input.voids.count,
    voidValue: new Decimal(input.voids.value).toFixed(2),
    voidsApproved: input.voids.approved,
    discounts: input.discounts.count,
    discountAmount: new Decimal(input.discounts.amount).toFixed(2),
    discountsApproved: input.discounts.approved,
    overLimit: input.overLimit,
  };
}

// Settings › Restaurant › Audit log for these days (calendar days), one kind
// (VOID: voided lines; OVERRIDE: a manager's approvals) and maybe one person.
export function auditHref(range: DateRange, type: "VOID" | "OVERRIDE", user?: string | null): string {
  const q = new URLSearchParams({ from: range.from, to: range.to, type });
  if (user) q.set("user", user);
  return `/settings/restaurant/audit?${q.toString()}`;
}
