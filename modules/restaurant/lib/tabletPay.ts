import type { PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";

// The tablet's PAY (6g follow-up 1): its own small rules — pure. What's due,
// each part's amount and whether a payment adds up are the server's and
// lib/tender's; this is only how the sheet's keys and choices behave.

// Cash, card and transfer (cheques stay on the desktop POS).
export const TABLET_METHODS: readonly PaymentType[] = ["CASH", "CARD", "BANK_TRANSFER"];
export const TABLET_METHOD_LABEL: Record<string, string> = { CASH: "CASH", CARD: "CARD", BANK_TRANSFER: "TRANSFER" };

// Split equally: 2 to 10 ways on a tablet.
export const TABLET_SPLIT_WAYS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const TABLET_MAX_GUESTS = 10;

// The tip step's quick choices (% of what's due), besides No tip and an amount.
export const TIP_PERCENTS = [5, 10, 15] as const;
export function tipFor(due: Decimal.Value, percent: number): string {
  return new Decimal(due).times(percent).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(2);
}

// Reasons for a discount: one is needed (the server says so too).
export const TABLET_DISCOUNT_REASONS = ["Regular guest", "Complaint", "Staff meal", "Promotion", "Manager's call"] as const;

// The keypad: digits and 00 add (no leading zeros, at most 9 digits), ⌫
// takes one off. `fresh`: the first key replaces what was there.
export function keyed(current: string, key: string, fresh: boolean): string {
  const base = fresh ? "" : current;
  if (key === "⌫") return base.slice(0, -1);
  if (!/^\d+$/.test(key)) return base;
  return (base + key).replace(/^0+(?=\d)/, "").slice(0, 9);
}

// One way of paying on the bill (or a part): a method and what's handed over.
export type PayRow = { paymentType: PaymentType; amount: string };

const sum = (rows: readonly PayRow[]) => rows.reduce((total, row) => total.plus(row.amount || "0"), new Decimal(0));

// What's left for row `index` once the others are counted (never below 0).
export function leftFor(owed: Decimal.Value, rows: readonly PayRow[], index: number): string {
  const others = sum(rows.filter((_, i) => i !== index));
  return Decimal.max(new Decimal(owed).minus(others), 0).toFixed(2);
}

// Another method: the first one not used yet, for what's still to pay.
export function addMethod(owed: Decimal.Value, rows: readonly PayRow[]): PayRow[] | null {
  const free = TABLET_METHODS.find((m) => !rows.some((r) => r.paymentType === m));
  if (!free) return null;
  const left = Decimal.max(new Decimal(owed).minus(sum(rows)), 0).toFixed(2);
  return [...rows, { paymentType: free, amount: left }];
}

// A row switched to another method; one already used elsewhere swaps with it.
export function setMethod(rows: readonly PayRow[], index: number, method: PaymentType): PayRow[] {
  const other = rows.findIndex((r, i) => i !== index && r.paymentType === method);
  return rows.map((row, i) => (i === index ? { ...row, paymentType: method } : i === other ? { ...row, paymentType: rows[index].paymentType } : row));
}

// The bill can still be split or discounted: nothing of it paid yet.
export const billOpen = (split: { parts: readonly { status: string }[] } | null) => !split || split.parts.every((p) => p.status !== "PAID");
