import type { PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { formatNaira } from "@/lib/format";
import { sumSubtotals } from "@/lib/pricing";

// Taking payment for a bill (or one part of a split bill): what the guest
// hands over, by method, against what's due plus an optional tip.
//
//   - Each method at most once. Cash is what was handed over; card, bank
//     transfer and cheque are charged exactly, so together they can't come
//     to more than what's owed — change only ever comes from cash.
//   - Paid in full: the methods come to at least due + tip. The change is
//     the rest, out of the cash.
//   - The sale gets payments adding up to the amount due exactly; the tip
//     (for the waiter, kept apart from the sale) is taken from the last
//     methods first — usually where the guest added it.
//
// The Payment pop-up uses this for its live figures and the Settle button;
// the server runs it again with the amount due it works out itself.

export const MAX_PAYMENT_METHODS = 4;

export type TenderRow = { paymentType: PaymentType; amount: Decimal.Value };
export type MethodAmount = { paymentType: PaymentType; amount: Decimal };

export type Tender =
  | {
      ok: true;
      collected: Decimal;
      change: Decimal;
      // Add up to the amount due / the tip.
      payments: MethodAmount[];
      tips: MethodAmount[];
    }
  | { ok: false; error: string; collected: Decimal; short: Decimal };

const money = (value: Decimal) => formatNaira(value.toFixed(2));

export function tender(due: Decimal.Value, tip: Decimal.Value, rows: readonly TenderRow[]): Tender {
  const owed = new Decimal(due).plus(tip);
  const amounts = rows.map((row) => ({ paymentType: row.paymentType, amount: new Decimal(row.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }));
  const collected = sumSubtotals(amounts.map((row) => row.amount));
  const fail = (error: string) => ({ ok: false as const, error, collected, short: Decimal.max(owed.minus(collected), 0) });

  if (new Decimal(tip).isNegative() || amounts.some((row) => row.amount.isNegative())) return fail("Amounts can't be below ₦0.00.");
  if (new Set(amounts.map((row) => row.paymentType)).size !== amounts.length) return fail("Use each payment method once.");
  if (amounts.length > MAX_PAYMENT_METHODS) return fail(`Use at most ${MAX_PAYMENT_METHODS} payment methods.`);
  const exact = sumSubtotals(amounts.filter((row) => row.paymentType !== "CASH").map((row) => row.amount));
  if (exact.greaterThan(owed)) return fail(`Card, transfer and cheque come to ${money(exact)}, more than the ${money(owed)} owed. Change only comes from cash.`);
  if (collected.lessThan(owed)) return fail(`${money(owed.minus(collected))} still to pay.`);

  const change = collected.minus(owed);
  // What each method keeps once the change is handed back out of the cash.
  const kept = amounts.map((row) => ({ ...row, amount: row.paymentType === "CASH" ? row.amount.minus(change) : row.amount }));
  let tipLeft = new Decimal(tip);
  const tips: MethodAmount[] = [];
  const payments: MethodAmount[] = [];
  for (const row of [...kept].reverse()) {
    const toTip = Decimal.min(row.amount, tipLeft);
    tipLeft = tipLeft.minus(toTip);
    if (toTip.greaterThan(0)) tips.unshift({ paymentType: row.paymentType, amount: toTip });
    if (row.amount.minus(toTip).greaterThan(0)) payments.unshift({ paymentType: row.paymentType, amount: row.amount.minus(toTip) });
  }
  return { ok: true, collected, change, payments, tips };
}

// Quick-cash buttons for the cash handed over: the next round amounts above
// what's left to pay in cash (₦500, ₦1,000, ₦5,000 and ₦10,000 steps).
export function quickCash(amount: Decimal.Value): Decimal[] {
  const value = new Decimal(amount);
  if (value.lte(0)) return [];
  const steps = [500, 1000, 5000, 10000].map((step) => value.div(step).ceil().times(step));
  return [...new Map(steps.filter((s) => s.greaterThan(value)).map((s) => [s.toFixed(0), s])).values()].slice(0, 4);
}
