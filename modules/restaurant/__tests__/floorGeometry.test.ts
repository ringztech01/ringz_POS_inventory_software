// Run with: npx tsx --test modules/restaurant/__tests__/floorGeometry.test.ts
// The floor plan's geometry (lib/floorGeometry.ts): default shapes, the tidy
// grid new tables start in, the room that fits them, overlaps.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boxesOverlap,
  clampToRoom,
  DEFAULT_ROOM,
  duplicateNumbers,
  firstFreeSlot,
  firstFreeSpot,
  fromPercent,
  gridSlot,
  insideRoom,
  itemsOverlap,
  nextTableNumber,
  overlappingTables,
  roomHeightFor,
  rotatedBounds,
  shapeForSeats,
  snap,
  toPercent,
} from "../lib/floorGeometry";

test("a table's default shape and size come from its seats", () => {
  assert.deepEqual(shapeForSeats(1), { shape: "ROUND", w: 1.2, h: 1.2 });
  assert.deepEqual(shapeForSeats(2), { shape: "ROUND", w: 1.2, h: 1.2 });
  assert.deepEqual(shapeForSeats(4), { shape: "SQUARE", w: 1.4, h: 1.4 });
  assert.deepEqual(shapeForSeats(6), { shape: "RECT", w: 2.6, h: 1.4 });
  assert.deepEqual(shapeForSeats(10), { shape: "RECT", w: 3.2, h: 1.6 });
});

test("the tidy grid: three to a row, the longest default table clear of the next and inside 12 m", () => {
  assert.deepEqual([0, 1, 2, 3].map(gridSlot), [{ x: 0.4, y: 0.4 }, { x: 4.2, y: 0.4 }, { x: 8, y: 0.4 }, { x: 0.4, y: 2.6 }]);
  const longest = shapeForSeats(12);
  const row = [0, 1, 2].map((i) => ({ ...gridSlot(i), w: longest.w, h: longest.h }));
  assert.equal(row.some((a, i) => row.some((b, j) => i !== j && boxesOverlap(a, b))), false, "no overlap in a row");
  assert.ok(row[2].x + row[2].w <= DEFAULT_ROOM.widthM, "the row fits the room");
  assert.equal(boxesOverlap({ ...gridSlot(0), w: 3.2, h: 1.6 }, { ...gridSlot(3), w: 3.2, h: 1.6 }), false, "rows clear too");
});

test("the room is at least 8 m deep, and deep enough for its tables in that grid", () => {
  assert.equal(roomHeightFor(0), 8);
  assert.equal(roomHeightFor(9), 8);
  assert.equal(roomHeightFor(13), 11.4);
  const last = gridSlot(12);
  assert.ok(last.y + 1.6 <= roomHeightFor(13));
});

test("overlap: shared area only — touching edges are fine", () => {
  const a = { x: 0, y: 0, w: 2, h: 2 };
  assert.equal(boxesOverlap(a, { x: 1, y: 1, w: 2, h: 2 }), true);
  assert.equal(boxesOverlap(a, { x: 2, y: 0, w: 2, h: 2 }), false);
  assert.equal(boxesOverlap(a, { x: 0, y: 2.01, w: 1, h: 1 }), false);
});

test("a new table goes in the first grid slot nothing overlaps", () => {
  assert.deepEqual(firstFreeSlot([], 1.4, 1.4), { x: 0.4, y: 0.4 });
  // The first slot taken (by a table someone dragged there): the next one.
  assert.deepEqual(firstFreeSlot([{ x: 0.5, y: 0.5, w: 1.4, h: 1.4 }], 1.4, 1.4), { x: 4.2, y: 0.4 });
  // A long table across the first two slots: the third.
  assert.deepEqual(firstFreeSlot([{ x: 0.2, y: 0.2, w: 5, h: 1.2 }], 1.4, 1.4), { x: 8, y: 0.4 });
});

// ---- The editor (Step 2)
const ROOM = { widthM: 12, heightM: 8 };
const at = (x: number, y: number, w = 1.4, h = 1.4, rotation = 0) => ({ x, y, w, h, rotation });

test("snap: to the grid when on, to 10 cm when off", () => {
  assert.equal(snap(1.26, 0.5, true), 1.5);
  assert.equal(snap(1.24, 0.5, true), 1);
  assert.equal(snap(1.26, 0.5, false), 1.3);
  assert.equal(snap(3.333, 0.25, true), 3.25);
});

test("a rotated item's box: 90° swaps width and height about the centre; 45° grows it", () => {
  const b = rotatedBounds(at(2, 2, 2.6, 1.4, 90));
  assert.deepEqual([b.x, b.y, b.w, b.h].map((v) => Math.round(v * 100) / 100), [2.6, 1.4, 1.4, 2.6]);
  const d = rotatedBounds(at(0, 0, 1, 1, 45));
  assert.ok(Math.abs(d.w - Math.SQRT2) < 1e-9 && Math.abs(d.h - Math.SQRT2) < 1e-9);
});

test("clamp: an item pushed past a wall comes back inside, rotated box and all", () => {
  assert.deepEqual(clampToRoom(at(11.5, 7.5), ROOM), at(10.6, 6.6));
  const turned = clampToRoom(at(0, 0, 2.6, 1.4, 90), ROOM);
  assert.ok(insideRoom(turned, ROOM), JSON.stringify(turned));
  assert.equal(insideRoom(at(11, 0, 1.4, 1.4), ROOM), false);
  assert.equal(insideRoom(at(10.6, 6.6), ROOM), true, "touching the walls is inside");
});

test("overlap: by the rotated boxes; touching is fine", () => {
  assert.equal(itemsOverlap(at(0, 0), at(1.4, 0)), false);
  assert.equal(itemsOverlap(at(0, 0), at(1.3, 0)), true);
  // A long table side by side with a square: clear — until it's turned 90°.
  assert.equal(itemsOverlap(at(0, 2, 2.6, 0.8), at(1.2, 0.5, 1, 1)), false);
  assert.equal(itemsOverlap(at(0, 2, 2.6, 0.8, 90), at(1.2, 0.5, 1, 1)), true);
  const keyed = [{ key: "a", ...at(0, 0) }, { key: "b", ...at(1, 1) }, { key: "c", ...at(5, 5) }];
  assert.deepEqual([...overlappingTables(keyed)].sort(), ["a", "b"]);
});

test("table numbers: unique across every area, any case; a blank one is flagged too", () => {
  const all = [{ key: "1", name: "T1" }, { key: "2", name: "t1" }, { key: "3", name: "G1" }, { key: "4", name: " " }];
  assert.deepEqual([...duplicateNumbers(all)].sort(), ["1", "2", "4"]);
});

test("the next number: the area's prefix and one more; with none, one more than the highest plain number", () => {
  assert.equal(nextTableNumber("T", ["T1", "T2", "T5"], ["T1", "T2", "T5", "G1"]), "T6");
  assert.equal(nextTableNumber("T", [], ["G1"]), "T1");
  assert.equal(nextTableNumber(null, ["3"], ["1", "12", "T4"]), "13");
  // Never one already used in another area.
  assert.equal(nextTableNumber("T", ["T1"], ["T1", "T2"]), "T3");
});

test("the first free spot: on the grid, clear of everything there", () => {
  assert.deepEqual(firstFreeSpot([], 1.4, 1.4, ROOM, 0.5), { x: 0.5, y: 0.5 });
  assert.deepEqual(firstFreeSpot([at(0.5, 0.5)], 1.4, 1.4, ROOM, 0.5), { x: 2, y: 0.5 });
});

test("metres → a share of the room and back (the service view)", () => {
  const box = { x: 3, y: 2, w: 1.2, h: 1.6 };
  assert.deepEqual(toPercent(box, ROOM), { x: 25, y: 25, w: 10, h: 20 });
  assert.deepEqual(fromPercent(toPercent(box, ROOM), ROOM), box);
});
