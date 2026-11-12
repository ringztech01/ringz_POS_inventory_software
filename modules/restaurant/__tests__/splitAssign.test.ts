// Run with: npx tsx --test modules/restaurant/__tests__/splitAssign.test.ts
// The Split pop-up's By item state (lib/splitAssign.ts): cards, taps,
// shares, guests, and the split the server gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addShares } from "../lib/billSplit";
import { assignUnit, buildCards, emptyUnits, fromParts, guestItemsKobo, reconcile, removeGuest, restTo, returnUnit, shareUnit, splitEven, toParts, unassigned, type Units } from "../lib/splitAssign";

// The G3 demo bill: 2 Egusi rows (identical), Pepper Soup, Fried Rice with a
// note and one without, 3 Star, 2 Zobo.
const L = (id: string, name: string, quantity: number, amount: string, modifiers: string[] = [], note: string | null = null) => ({ id, name, quantity, amountValue: amount, modifiers: modifiers.map((n) => ({ name: n })), note });
const lines = [
  L("e1", "Egusi Soup", 1, "6500.00", ["Pounded yam", "Goat meat"]),
  L("e2", "Egusi Soup", 1, "6500.00", ["Pounded yam", "Goat meat"]),
  L("p", "Goat Meat Pepper Soup", 1, "5000.00", ["Hot"]),
  L("r1", "Fried Rice & Turkey", 1, "7000.00", ["Large"], "One without pepper"),
  L("r2", "Fried Rice & Turkey", 1, "7000.00", ["Large"]),
  L("s", "Star Lager", 3, "4500.00", ["Chilled"]),
  L("z", "Zobo", 2, "3000.00"),
];
const cards = buildCards(lines);
const keyOf = (name: string, detail = "") => cards.find((c) => c.name === name && c.detail.startsWith(detail))!.key;
const must = (u: Units | null) => {
  assert.ok(u);
  return u;
};

test("cards: identical lines merged; a different note or option stays apart and is shown", () => {
  assert.deepEqual(cards.map((c) => [c.name, c.qty, c.detail, c.unitKobo]), [
    ["Egusi Soup", 2, "Pounded yam · Goat meat", 650000],
    ["Goat Meat Pepper Soup", 1, "Hot", 500000],
    ["Fried Rice & Turkey", 1, "Large · “One without pepper”", 700000],
    ["Fried Rice & Turkey", 1, "Large", 700000],
    ["Star Lager", 3, "Chilled", 150000],
    ["Zobo", 2, "", 150000],
  ]);
  assert.deepEqual(cards[0].lines, [{ id: "e1", quantity: 1 }, { id: "e2", quantity: 1 }]);
});

test("6 items between 3 guests in 7 taps, with Rest to Guest 3", () => {
  let u = emptyUnits(cards);
  u = must(assignUnit(u, keyOf("Egusi Soup"), 1));
  u = must(assignUnit(u, keyOf("Goat Meat Pepper Soup"), 1));
  // (tap Guest 2)
  u = must(assignUnit(u, keyOf("Fried Rice & Turkey", "Large · “"), 2));
  u = must(assignUnit(u, keyOf("Star Lager"), 2));
  // (+ Guest 3, picked)
  const rest = restTo(u, 3);
  assert.equal(rest.count, 6);
  assert.deepEqual(unassigned(rest.units, cards), { count: 0, kobo: 0 });
  const parts = toParts(rest.units, cards, [1, 2, 3]);
  assert.deepEqual(parts, [
    [{ lineId: "e1", quantity: 1, shareOf: 1 }, { lineId: "p", quantity: 1, shareOf: 1 }],
    [{ lineId: "r1", quantity: 1, shareOf: 1 }, { lineId: "s", quantity: 1, shareOf: 1 }],
    [{ lineId: "e2", quantity: 1, shareOf: 1 }, { lineId: "r2", quantity: 1, shareOf: 1 }, { lineId: "s", quantity: 2, shareOf: 1 }, { lineId: "z", quantity: 2, shareOf: 1 }],
  ]);
  assert.equal(assignUnit(rest.units, keyOf("Zobo"), 1), null, "none left to give");
});

test("sharing: one unit evenly; returning a share keeps the others'; the server's parts add up per line", () => {
  let u = emptyUnits(cards);
  u = must(shareUnit(u, keyOf("Goat Meat Pepper Soup"), [1, 2]));
  assert.equal(shareUnit(u, keyOf("Goat Meat Pepper Soup"), [1, 2]), null, "nothing left to share");
  assert.equal(shareUnit(u, keyOf("Zobo"), [1, 1]), null, "two different guests");
  u = must(shareUnit(u, keyOf("Zobo"), [1, 2, 3]));
  u = restTo(u, 3).units;
  const parts = toParts(u, cards, [1, 2, 3]);
  const pepper = parts.flatMap((p) => p.filter((a) => a.lineId === "p"));
  assert.deepEqual(pepper, [{ lineId: "p", quantity: 1, shareOf: 2 }, { lineId: "p", quantity: 1, shareOf: 2 }]);
  // Zobo: ⅓ + ⅓ + (⅓ + 1 whole) = 2.
  assert.deepEqual(addShares(parts.flatMap((p) => p.filter((a) => a.lineId === "z"))), { quantity: 2, shareOf: 1 });
  assert.deepEqual(parts[2].find((a) => a.lineId === "z"), { lineId: "z", quantity: 4, shareOf: 3 });
  // The kobo: 1,500 ÷ 3 → 500 each.
  assert.deepEqual(splitEven(100000, 3), [33333, 33333, 33334]);
  const back = returnUnit(u, keyOf("Goat Meat Pepper Soup"), 0, 1);
  assert.deepEqual(back[keyOf("Goat Meat Pepper Soup")], [[2]], "Guest 2 now has all of it");
});

test("removing a guest never loses an item; their shares go to the others", () => {
  let u = emptyUnits(cards);
  u = must(assignUnit(u, keyOf("Egusi Soup"), 2));
  u = must(shareUnit(u, keyOf("Zobo"), [1, 2]));
  u = restTo(u, 1).units;
  const after = removeGuest(u, 2);
  assert.deepEqual(unassigned(after, cards).count, 1, "Guest 2's Egusi is back");
  assert.deepEqual(after[keyOf("Zobo")][0], [1], "the shared Zobo is Guest 1's");
  const totals = guestItemsKobo(after, cards, [1]);
  assert.equal(totals[1] + unassigned(after, cards).kobo, 3950000, "every kobo is someone's or unassigned");
});

test("Edit split: a saved split reads back — whole units and ½ shares", () => {
  let u = emptyUnits(cards);
  u = must(shareUnit(u, keyOf("Goat Meat Pepper Soup"), [1, 2]));
  u = must(assignUnit(u, keyOf("Egusi Soup"), 1));
  u = restTo(u, 2).units;
  const saved = toParts(u, cards, [1, 2]).map((items) => ({ items: items.map((i) => ({ ...i, shareOf: i.shareOf ?? 1 })) }));
  const back = fromParts(cards, saved);
  assert.deepEqual(back.guests, [1, 2]);
  assert.deepEqual(back.units, u);
});

test("the bill changed meanwhile: assignments kept, new units unassigned, a gone line dropped", () => {
  let u = emptyUnits(cards);
  u = must(assignUnit(u, keyOf("Zobo"), 1));
  u = must(assignUnit(u, keyOf("Star Lager"), 2));
  const changed = buildCards([...lines.filter((l) => l.id !== "p").map((l) => (l.id === "z" ? { ...l, quantity: 3, amountValue: "4500.00" } : l.id === "s" ? { ...l, quantity: 2, amountValue: "3000.00" } : l))]);
  const kept = reconcile(u, changed);
  assert.deepEqual(kept[keyOf("Zobo")], [[1], null, null], "one more Zobo, unassigned");
  assert.deepEqual(kept[keyOf("Star Lager")], [[2], null], "a Star fewer — an unassigned one went");
  assert.equal(kept[keyOf("Goat Meat Pepper Soup")], undefined);
});
