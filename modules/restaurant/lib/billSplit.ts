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
//           order's discount and service charge shared out by sub total. A
//           unit can be shared: a guest pays `quantity` shares of
//           1/`shareOf` of it (½ a Pepper Soup: 1 of 2)
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
// `quantity` shares of 1/`shareOf` of a unit (shareOf 1, or left out: whole units).
export type ItemAssignment = { lineId: string; quantity: number; shareOf?: number };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
const VULGAR: Record<string, string> = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/5": "⅕", "1/6": "⅙", "1/8": "⅛" };

// q/s of a unit in its lowest terms.
export function reduceShare(quantity: number, shareOf = 1): { quantity: number; shareOf: number } {
  const d = gcd(quantity, shareOf) || 1;
  return { quantity: quantity / d, shareOf: shareOf / d };
}

// "2", "½", "1½", "⅔", "3/7" — how many units q/s is.
export function unitsLabel(quantity: number, shareOf = 1): string {
  const r = reduceShare(quantity, shareOf);
  const whole = Math.floor(r.quantity / r.shareOf);
  const rest = r.quantity % r.shareOf;
  if (rest === 0) return String(whole);
  const fraction = VULGAR[`${rest}/${r.shareOf}`] ?? `${rest}/${r.shareOf}`;
  return whole ? `${whole}${fraction.length > 1 ? " " : ""}${fraction}` : fraction;
}

// Several picks of one line added up: one q/s in lowest terms.
export function addShares(picks: readonly { quantity: number; shareOf?: number }[]): { quantity: number; shareOf: number } {
  const den = picks.reduce((d, p) => lcm(d, p.shareOf ?? 1), 1);
  const num = picks.reduce((n, p) => n + p.quantity * (den / (p.shareOf ?? 1)), 0);
  return reduceShare(num, den);
}

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
  const assigned = new Map<string, { quantity: number; shareOf?: number }[]>();
  for (const [i, part] of parts.entries()) {
    if (part.every((a) => a.quantity <= 0)) return { ok: false, error: `Guest ${i + 1} has nothing assigned yet.` };
    for (const a of part) {
      if (!byId.has(a.lineId)) return { ok: false, error: "An item isn't on the bill any more. Close the split and try again." };
      const per = a.shareOf ?? 1;
      if (!Number.isInteger(a.quantity) || a.quantity < 0 || !Number.isInteger(per) || per < 1 || per > MAX_BILL_PARTS) return { ok: false, error: "Assign whole items, or an item shared between guests." };
      assigned.set(a.lineId, [...(assigned.get(a.lineId) ?? []), { quantity: a.quantity, shareOf: per }]);
    }
  }
  // Every unit exactly once — compared as whole numbers of 1/L shares.
  for (const line of lines) {
    const got = addShares(assigned.get(line.id) ?? [{ quantity: 0 }]);
    const have = got.quantity, want = line.quantity * got.shareOf;
    const count = unitsLabel(got.quantity, got.shareOf);
    if (have < want) return { ok: false, error: `Assign every ${line.name} (${count} of ${line.quantity} assigned).` };
    if (have > want) return { ok: false, error: `More ${line.name} assigned than were ordered (${count} of ${line.quantity}).` };
  }

  // Each guest: their lines with their tax, less their share of the
  // discount, plus their share of the service charge. Whole units are
  // priced as on the bill; a part of a unit is that share of one unit's
  // price and tax (the last guest takes any rounding, as always).
  const shareOf = (subTotal: Decimal, amount: Decimal) => (bill.subTotal.isZero() ? new Decimal(0) : kobo(amount.times(subTotal).div(bill.subTotal)));
  const first = parts.slice(0, -1).map((part) => {
    const picks = [...Map.groupBy(part.filter((a) => a.quantity > 0), (a) => a.lineId)].map(([lineId, ps]) => ({ line: byId.get(lineId)!, ...addShares(ps) }));
    const whole = orderTotals(
      picks.filter((p) => p.quantity >= p.shareOf).map((p) => ({ ...p.line, quantity: Math.floor(p.quantity / p.shareOf) })),
      0,
    );
    let subTotal = whole.subTotal;
    let tax = whole.tax;
    for (const p of picks) {
      const rest = p.quantity % p.shareOf;
      if (!rest) continue;
      const one = orderTotals([{ ...p.line, quantity: 1 }], 0);
      subTotal = subTotal.plus(kobo(one.subTotal.times(rest).div(p.shareOf)));
      tax = tax.plus(kobo(one.tax.times(rest).div(p.shareOf)));
    }
    return subTotal.plus(tax).minus(shareOf(subTotal, bill.discount)).plus(shareOf(subTotal, bill.serviceCharge));
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
