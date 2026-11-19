// Run with: npx tsx --test modules/restaurant/__tests__/tabletTables.test.ts
// Part 6g Step 3: the tablet's Tables tiles (lib/tabletTables.ts) — the
// desktop's look for each table, what a tile says, MY TABLES and the
// Bartender's area.
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaFree, barArea, dimmed, floorLabels, legendCounts, lookLabel, tableTitle, tabletLook, tabletTile } from "../lib/tabletTables";

const order = (o: Partial<{ id: string; ref: string; check: string | null; stage: "SEATED" | "SENT" | "LATE" | "BILL"; waiterId: string | null; waiterName: string | null; minutes: number; total: string; guests: number }> = {}) => ({
  id: "o1",
  ref: "ORD-0001",
  check: null,
  stage: "SENT" as const,
  waiterId: "ada",
  waiterName: "Ada Okafor",
  minutes: 24,
  total: "₦18,400.00",
  guests: 4,
  ...o,
});
const table = (t: Partial<Parameters<typeof tabletTile>[0]> = {}) => ({ id: "t1", name: "3", seats: 4, status: "Available" as const, order: null, checks: [], checksTotal: "₦0.00", reservation: null, ...t });

test("the look: the desktop's rule — an open table's order stage, else reserved, cleaning or free", () => {
  assert.equal(tabletLook({ status: "Occupied", order: { stage: "SEATED" } }), "SEATED");
  assert.equal(tabletLook({ status: "Occupied", order: { stage: "LATE" } }), "LATE");
  assert.equal(tabletLook({ status: "Occupied", order: { stage: "BILL" } }), "BILL");
  assert.equal(tabletLook({ status: "Reserved", order: null }), "RESERVED");
  assert.equal(tabletLook({ status: "Cleaning", order: null }), "CLEANING");
  assert.equal(tabletLook({ status: "Available", order: null }), "FREE");
});

test("an open table: its waiter's initials, minutes open and the total", () => {
  const o = order();
  const tile = tabletTile(table({ status: "Occupied", order: o, checks: [o], checksTotal: o.total }), "ada");
  assert.deepEqual([tile.look, tile.initials, tile.mine, tile.minutes, tile.total, tile.info], ["SENT", "AO", true, 24, "₦18,400.00", "24 min"]);
  assert.deepEqual(tile.checks, [{ id: "o1", label: "ORD-0001", total: "₦18,400.00", guests: 4, look: "SENT", initials: "AO", minutes: 24, lines: [] }]);
  assert.equal(lookLabel(tile), "Food sent");
  assert.equal(tabletTile(table({ status: "Occupied", order: o, checks: [o] }), "bisi").mine, false);
});

test("a shared table: every check, all of them together", () => {
  const a = order({ id: "o1", check: "Ada", total: "₦5,000.00" });
  const b = order({ id: "o2", check: null, waiterId: "bisi", total: "₦7,000.00" });
  const tile = tabletTile(table({ status: "Occupied", order: a, checks: [a, b], checksTotal: "₦12,000.00" }), "bisi");
  assert.equal(tile.total, "₦12,000.00");
  assert.equal(tile.mine, true, "one of its checks is hers");
  assert.deepEqual(tile.checks.map((c) => c.label), ["Ada", "Check 2"]);
});

test("free: Tap to seat; reserved: the booking; cleaning: says so", () => {
  const free = tabletTile(table(), "ada");
  assert.deepEqual([free.look, free.info, free.initials, free.total, free.checks.length, lookLabel(free)], ["FREE", "Tap to seat", null, null, 0, "Free"]);
  const booked = tabletTile(table({ status: "Reserved", reservation: { id: "r1", guestName: "Okafor", partySize: 4, time: "20:00" } }), "ada");
  assert.deepEqual([booked.look, booked.info, lookLabel(booked)], ["RESERVED", "Okafor · 4", "Reserved 20:00"]);
  assert.equal(tabletTile(table({ status: "Cleaning" }), "ada").info, "Needs cleaning");
});

test("MY TABLES: others' open tables dim, free and booked ones don't; a manager sees them all", () => {
  const o = order({ waiterId: "bisi" });
  const theirs = tabletTile(table({ status: "Occupied", order: o, checks: [o] }), "ada");
  const free = tabletTile(table(), "ada");
  assert.equal(dimmed(theirs, true, false), true);
  assert.equal(dimmed(theirs, false, false), false);
  assert.equal(dimmed(theirs, true, true), false, "a manager");
  assert.equal(dimmed(free, true, false), false);
});

test("an area's free count, and a Bartender's area", () => {
  assert.equal(areaFree({ free: 3, total: 12 }), "3 of 12 free");
  assert.equal(barArea([{ id: "a", name: "Main hall" }, { id: "b", name: "Rooftop Bar" }]), "b");
  assert.equal(barArea([{ id: "a", name: "Main hall" }, { id: "b", name: "Barbecue garden" }]), null, "not a bar");
  assert.equal(barArea([]), null);
});

test("a check's lines on the side panel: the desktop's kitchen words", () => {
  const o = { ...order(), lines: [{ id: "l1", quantity: 2, name: "Egusi Soup", amount: "₦7,600.00", kitchenStatus: "PENDING" as const }, { id: "l2", quantity: 3, name: "Star Lager", amount: "₦3,600.00", kitchenStatus: "NEW" as const }] };
  const tile = tabletTile(table({ status: "Occupied", order: o, checks: [o] }), "ada");
  assert.deepEqual(tile.checks[0].lines, [
    { id: "l1", quantity: 2, name: "Egusi Soup", state: "SENT" },
    { id: "l2", quantity: 3, name: "Star Lager", state: "NEW" },
  ]);
  assert.deepEqual([tile.checks[0].look, tile.checks[0].initials, tile.checks[0].minutes], ["SENT", "AO", 24]);
});

test("on the floor, by width: the number; from 70 px who and how long; from 150 px the total", () => {
  const o = order();
  const busy = tabletTile(table({ status: "Occupied", order: o, checks: [o] }), "ada");
  assert.deepEqual(floorLabels(busy, 69), { line1: null, line2: null, big: false });
  assert.deepEqual(floorLabels(busy, 70), { line1: "AO · 24m", line2: null, big: true });
  assert.deepEqual(floorLabels(busy, 149), { line1: "AO · 24m", line2: null, big: true });
  assert.deepEqual(floorLabels(busy, 150), { line1: "AO · 24m", line2: "₦18,400.00", big: true });
  assert.deepEqual(floorLabels(tabletTile(table(), "ada"), 200), { line1: null, line2: null, big: true }, "a free table: its number");
});

test("the floor's legend counts, and a table's title", () => {
  const o = order();
  const tiles = [tabletTile(table(), "a"), tabletTile(table(), "a"), tabletTile(table({ status: "Occupied", order: o, checks: [o] }), "a"), tabletTile(table({ status: "Reserved" }), "a")];
  const counts = legendCounts(tiles);
  assert.deepEqual([counts.FREE, counts.SENT, counts.RESERVED, counts.LATE], [2, 1, 1, 0]);
  assert.equal(tableTitle("5"), "Table 5");
  assert.equal(tableTitle("V1"), "V1");
});
