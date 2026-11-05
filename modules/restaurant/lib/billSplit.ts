import type { BillSplitMode } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { formatNaira } from "@/lib/format";
import { sumSubtotals } from "@/lib/pricing";
import { orderTotals, type PricedLine } from "./orderTotals";

// Splitting a bill into parts that each guest pays on their own:
//
//   EQUAL   the total N ways
//   AMOUNT  the amounts the first guests chose; the last pays the rest
//   ITEMS   what each guest had — their lines' share of the bill, with the
//           order's discount and service charge shared out by sub total
//
// The parts always add up exactly to the bill total: each is worked out to
// the kobo and the last part takes whatever is left (the rounding). Called
// on the server, which saves the parts; the Split pop-up uses it only for
// its preview.

export const MAX_BILL_PARTS = 30;

export type SplitResult = { ok: true; amounts: Decimal[] } | { ok: false; error: string };

const money = (value: Decimal) => formatNaira(value.toFixed(2));
const kobo = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

// The first parts as worked out, then the last: the total less the others.
function lastTakesTheRest(total: Decimal, first: Decimal[]): Decimal[] {
  return [...first, total.minus(sumSubtotals(first))];
}

export function splitEqually(total: Decimal.Value, ways: number): SplitResult {
  const whole = new Decimal(total);
  if (!Number.isInteger(ways) || ways < 2 || ways > MAX_BILL_PARTS) return { ok: false, error: `Split 2 to ${MAX_BILL_PARTS} ways.` };
  // Rounded down, so the last part is never less than the others.
  const each = whole.div(ways).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (each.lte(0)) return { ok: false, error: `${money(whole)} is too little to split ${ways} ways.` };
  return { ok: true, amounts: lastTakesTheRest(whole, Array.from({ length: ways - 1 }, () => each)) };
}

// `amounts`: the first parts; one more part pays what's left.
export function splitByAmounts(total: Decimal.Value, amounts: readonly Decimal.Value[]): SplitResult {
  const whole = new Decimal(total);
  if (amounts.length < 1 || amounts.length + 1 > MAX_BILL_PARTS) return { ok: false, error: `Split into 2 to ${MAX_BILL_PARTS} parts.` };
  const first = amounts.map((a) => kobo(new Decimal(a)));
  if (first.some((a) => a.lte(0))) return { ok: false, error: "Every part needs an amount above ₦0.00." };
  const chosen = sumSubtotals(first);
  if (chosen.gte(whole)) return { ok: false, error: `Those parts come to ${money(chosen)} but the bill is ${money(whole)}. Leave something for the last part.` };
  return { ok: true, amounts: lastTakesTheRest(whole, first) };
}

export type SplitLine = PricedLine & { id: string; name: string };
export type ItemAssignment = { lineId: string; quantity: number };

// `lines`: the billed lines. `parts`: per guest, how many of each line's
// units they pay for — every unit of every billed line exactly once.
// `bill`: the order's own totals (orderTotals with its discount and service
// charge), whose discount and service charge are shared out.
export function splitByItems(
  lines: readonly SplitLine[],
  parts: readonly (readonly ItemAssignment[])[],
  bill: { subTotal: Decimal; discount: Decimal; serviceCharge: Decimal; total: Decimal },
): SplitResult {
  if (parts.length < 2 || parts.length > MAX_BILL_PARTS) return { ok: false, error: `Split between 2 and ${MAX_BILL_PARTS} guests.` };
  const byId = new Map(lines.map((line) => [line.id, line]));
  const assigned = new Map<string, number>();
  for (const [i, part] of parts.entries()) {
    if (part.every((a) => a.quantity <= 0)) return { ok: false, error: `Guest ${i + 1} has nothing assigned yet.` };
    for (const a of part) {
      if (!byId.has(a.lineId)) return { ok: false, error: "An item isn't on the bill any more. Close the split and try again." };
      if (!Number.isInteger(a.quantity) || a.quantity < 0) return { ok: false, error: "Assign whole items." };
      assigned.set(a.lineId, (assigned.get(a.lineId) ?? 0) + a.quantity);
    }
  }
  for (const line of lines) {
    const count = assigned.get(line.id) ?? 0;
    if (count < line.quantity) return { ok: false, error: `Assign every ${line.name} (${count} of ${line.quantity} assigned).` };
    if (count > line.quantity) return { ok: false, error: `More ${line.name} assigned than were ordered (${count} of ${line.quantity}).` };
  }

  // Each guest: their lines with their tax, less their share of the
  // discount, plus their share of the service charge.
  const shareOf = (subTotal: Decimal, amount: Decimal) => (bill.subTotal.isZero() ? new Decimal(0) : kobo(amount.times(subTotal).div(bill.subTotal)));
  const first = parts.slice(0, -1).map((part) => {
    const own = orderTotals(
      part.filter((a) => a.quantity > 0).map((a) => ({ ...byId.get(a.lineId)!, quantity: a.quantity })),
      0,
    );
    return own.subTotal.plus(own.tax).minus(shareOf(own.subTotal, bill.discount)).plus(shareOf(own.subTotal, bill.serviceCharge));
  });
  const amounts = lastTakesTheRest(bill.total, first);
  if (amounts[amounts.length - 1].lt(0)) return { ok: false, error: `Guest ${parts.length}'s part comes out below ₦0.00. Give them one of the priced items.` };
  return { ok: true, amounts };
}

// "1 of 3", "Guest 2", "Part 1".
export function billPartLabel(mode: BillSplitMode, number: number, count: number): string {
  return mode === "EQUAL" ? `${number} of ${count}` : mode === "ITEMS" ? `Guest ${number}` : `Part ${number}`;
}

export const SPLIT_MODE_LABEL: Record<BillSplitMode, string> = { EQUAL: "Equal split", ITEMS: "By item", AMOUNT: "By amount" };
