import { addShares, type ItemAssignment } from "./billSplit";

// The Split pop-up's By item state — pure (tested in splitAssign.test.ts).
//
//   cards    the bill's lines, identical ones merged ("2× Fried Rice &
//            Turkey") unless their options, note or price differ
//   units    per card, one entry per unit: who pays for it — null
//            (unassigned), [guest] or, shared, [guest, guest, …] (each pays
//            an even share; the server puts the rounding on the last part)
//   guests   ids in their order (Guest 1, 2, …); an id stays with its
//            colour when another guest is removed
//
// toParts turns that into the server's split (per guest: line, quantity,
// shareOf); fromParts reads a saved split back (Edit split).

export type SplitSourceLine = { id: string; name: string; quantity: number; amountValue: string; modifiers: { name: string }[]; note: string | null };
export type SplitCard = { key: string; name: string; detail: string; qty: number; unitKobo: number; lines: { id: string; quantity: number }[] };
export type Units = Record<string, (number[] | null)[]>;

const toKobo = (value: string) => Math.round(Number(value) * 100);

export function buildCards(lines: readonly SplitSourceLine[]): SplitCard[] {
  const cards: SplitCard[] = [];
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const unitKobo = Math.round(toKobo(line.amountValue) / line.quantity);
    const detail = [...line.modifiers.map((m) => m.name), ...(line.note ? [`“${line.note}”`] : [])].join(" · ");
    const key = `${line.name}|${detail}|${unitKobo}`;
    const same = cards.find((c) => c.key === key);
    if (same) {
      same.qty += line.quantity;
      same.lines.push({ id: line.id, quantity: line.quantity });
    } else cards.push({ key, name: line.name, detail, qty: line.quantity, unitKobo, lines: [{ id: line.id, quantity: line.quantity }] });
  }
  return cards;
}

export const emptyUnits = (cards: readonly SplitCard[]): Units => Object.fromEntries(cards.map((c) => [c.key, Array<number[] | null>(c.qty).fill(null)]));

// Assignments carried onto the bill as it is now (it changed meanwhile):
// cards that are gone drop out, new units are unassigned, and when a card
// has fewer units the unassigned ones go first.
export function reconcile(units: Units, cards: readonly SplitCard[]): Units {
  const out: Units = {};
  for (const c of cards) {
    const was = [...(units[c.key] ?? [])];
    while (was.length > c.qty) {
      const free = was.lastIndexOf(null);
      was.splice(free >= 0 ? free : was.length - 1, 1);
    }
    while (was.length < c.qty) was.push(null);
    out[c.key] = was;
  }
  return out;
}

const copy = (units: Units): Units => Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.map((u) => (u ? [...u] : null))]));

// One unit of the card to the guest; null when none is left.
export function assignUnit(units: Units, key: string, guest: number): Units | null {
  const at = (units[key] ?? []).indexOf(null);
  if (at < 0) return null;
  const next = copy(units);
  next[key][at] = [guest];
  return next;
}

// Everything still unassigned to the guest.
export function restTo(units: Units, guest: number): { units: Units; count: number } {
  let count = 0;
  const next = copy(units);
  for (const key of Object.keys(next)) next[key] = next[key].map((u) => (u ? u : (count++, [guest])));
  return { units: next, count };
}

// One unassigned unit shared evenly between the guests (2 or more).
export function shareUnit(units: Units, key: string, guests: readonly number[]): Units | null {
  const at = (units[key] ?? []).indexOf(null);
  if (at < 0 || new Set(guests).size < 2) return null;
  const next = copy(units);
  next[key][at] = [...new Set(guests)];
  return next;
}

// The guest gives back their unit (or their share of it — the others keep theirs).
export function returnUnit(units: Units, key: string, index: number, guest: number): Units {
  const next = copy(units);
  const u = next[key]?.[index];
  if (!u) return next;
  const rest = u.filter((g) => g !== guest);
  next[key][index] = rest.length ? rest : null;
  return next;
}

// A guest removed: everything they had goes back (shared units stay with the others).
export function removeGuest(units: Units, guest: number): Units {
  const next = copy(units);
  for (const key of Object.keys(next)) next[key] = next[key].map((u) => (u && u.includes(guest) ? (u.length > 1 ? u.filter((g) => g !== guest) : null) : u));
  return next;
}

export function unassigned(units: Units, cards: readonly SplitCard[]): { count: number; kobo: number } {
  let count = 0;
  let kobo = 0;
  for (const c of cards)
    for (const u of units[c.key] ?? [])
      if (!u) {
        count++;
        kobo += c.unitKobo;
      }
  return { count, kobo };
}

// Even shares to the kobo, the last taking the rounding.
export function splitEven(amount: number, n: number): number[] {
  const base = Math.floor(amount / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? amount - base * (n - 1) : base));
}

// What each guest has so far, in kobo of the items (before the bill's
// discount and service charge — the pop-up scales it to the bill for its
// preview; the server works out the parts).
export function guestItemsKobo(units: Units, cards: readonly SplitCard[], guests: readonly number[]): Record<number, number> {
  const out: Record<number, number> = Object.fromEntries(guests.map((g) => [g, 0]));
  for (const c of cards)
    for (const u of units[c.key] ?? []) {
      if (!u) continue;
      const order = guests.filter((g) => u.includes(g));
      splitEven(c.unitKobo, order.length).forEach((v, i) => (out[order[i]] += v));
    }
  return out;
}

// The line a card's unit index belongs to.
function lineAt(card: SplitCard, index: number): string {
  let left = index;
  for (const l of card.lines) {
    if (left < l.quantity) return l.id;
    left -= l.quantity;
  }
  return card.lines[card.lines.length - 1].id;
}

// The server's By item split: per guest (in order), each line's share.
export function toParts(units: Units, cards: readonly SplitCard[], guests: readonly number[]): ItemAssignment[][] {
  return guests.map((g) => {
    const picks = new Map<string, { quantity: number; shareOf: number }[]>();
    for (const c of cards)
      (units[c.key] ?? []).forEach((u, i) => {
        if (!u || !u.includes(g)) return;
        const lineId = lineAt(c, i);
        picks.set(lineId, [...(picks.get(lineId) ?? []), { quantity: 1, shareOf: u.length }]);
      });
    return [...picks].map(([lineId, ps]) => ({ lineId, ...addShares(ps) }));
  });
}

// A saved By item split read back: its guests and who had which unit.
// Shares of 1/k between k guests come back as one shared unit; anything
// that doesn't fit (e.g. ⅔ of a unit) comes back unassigned.
export function fromParts(cards: readonly SplitCard[], parts: readonly { items: readonly { lineId: string; quantity: number; shareOf: number }[] }[]): { guests: number[]; units: Units } {
  const guests = parts.map((_, i) => i + 1);
  const units = emptyUnits(cards);
  for (const c of cards) {
    let offset = 0;
    for (const l of c.lines) {
      const slots = Array.from({ length: l.quantity }, (_, i) => offset + i);
      offset += l.quantity;
      const pieces: { guest: number; rest: number; shareOf: number }[] = [];
      parts.forEach((p, gi) => {
        const it = p.items.find((x) => x.lineId === l.id);
        if (!it) return;
        const whole = Math.floor(it.quantity / it.shareOf);
        for (let k = 0; k < whole && slots.length; k++) units[c.key][slots.shift()!] = [gi + 1];
        const rest = it.quantity % it.shareOf;
        if (rest) pieces.push({ guest: gi + 1, rest, shareOf: it.shareOf });
      });
      for (const [k, group] of Map.groupBy(pieces.filter((x) => x.rest === 1), (x) => x.shareOf)) {
        for (let i = 0; i + k <= group.length && slots.length; i += k) units[c.key][slots.shift()!] = group.slice(i, i + k).map((x) => x.guest);
      }
    }
  }
  return { guests, units };
}
