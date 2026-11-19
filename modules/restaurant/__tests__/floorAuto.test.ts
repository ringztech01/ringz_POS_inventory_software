// Run with: npx tsx --test modules/restaurant/__tests__/floorAuto.test.ts
// 6g follow-up 3: an unsaved area's drawn floor (lib/floorAuto.ts) — a neat
// grid by table number, inside the room, nothing overlapping, the same every
// time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_GAP_M, AUTO_MARGIN_M, autoFloor, byTableNumber, planSaved, type AutoTable } from "../lib/floorAuto";

const room = { widthM: 12, heightM: 8 };
const t = (id: string, name: string, w = 1.4, h = 1.4): AutoTable => ({ id, name, w, h });
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("by table number: T2 before T10, then the id", () => {
  assert.deepEqual(byTableNumber([t("a", "T10"), t("b", "T2"), t("c", "t1"), t("d", "Bar 2"), t("e", "Bar 1")]).map((x) => x.name), ["Bar 1", "Bar 2", "t1", "T2", "T10"]);
  assert.deepEqual(byTableNumber([t("z", "T1"), t("y", "T1")]).map((x) => x.id), ["y", "z"], "same name: by id, so it never moves");
});

test("a neat grid: rows fill in number order, centred, inside the room, nothing overlapping", () => {
  const tables = ["T5", "T1", "T3", "T2", "T4", "T6"].map((n, i) => t(`id${i}`, n));
  const { room: drawn, places } = autoFloor(tables, room);
  assert.deepEqual(drawn, room, "6 tables fit a 12 × 8 m room");
  const byName = Object.fromEntries(tables.map((x) => [x.name, places[x.id]]));
  const ys = [...new Set(Object.values(places).map((p) => p.y))].sort((a, b) => a - b);
  const xs = [...new Set(Object.values(places).map((p) => p.x))].sort((a, b) => a - b);
  assert.equal(ys.length * xs.length, 6, "a full grid");
  assert.ok(byName.T1.y === ys[0] && byName.T1.x === xs[0], "T1 top left");
  assert.ok(byName.T2.x > byName.T1.x && byName.T2.y === byName.T1.y, "T2 next to it");
  for (const p of Object.values(places)) {
    assert.ok(p.x >= AUTO_MARGIN_M - 1e-9 && p.y >= AUTO_MARGIN_M - 1e-9 && p.x + p.w <= room.widthM - AUTO_MARGIN_M + 1e-9 && p.y + p.h <= room.heightM - AUTO_MARGIN_M + 1e-9, "inside the walls");
    assert.equal(p.rotation, 0);
  }
  const list = Object.values(places);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), "no overlap");
  const left = Math.min(...list.map((p) => p.x));
  const right = room.widthM - Math.max(...list.map((p) => p.x + p.w));
  assert.ok(Math.abs(left - right) < 0.02, "centred across");
});

test("each table keeps its size; mixed sizes sit centred in equal cells", () => {
  // A long, narrow room: one row.
  const { places } = autoFloor([t("a", "1", 1.2, 1.2), t("b", "2", 3.2, 1.6), t("c", "3", 1.4, 1.4)], { widthM: 30, heightM: 4 });
  assert.ok(places.a.y + places.a.h / 2 === places.c.y + places.c.h / 2, "one row, centred on the same line");
  assert.deepEqual([places.a.w, places.a.h, places.b.w, places.b.h], [1.2, 1.2, 3.2, 1.6]);
  const centre = (p: { x: number; w: number }) => p.x + p.w / 2;
  const step = centre(places.b) - centre(places.a);
  assert.ok(Math.abs(step - (3.2 + AUTO_GAP_M)) < 0.02, "cells as wide as the widest table plus the gap");
  assert.ok(Math.abs(centre(places.c) - centre(places.b) - step) < 0.02, "evenly spaced");
});

test("the same tables give the same floor; the input order doesn't matter", () => {
  const a = [t("x1", "T1"), t("x2", "T2"), t("x3", "T3")];
  assert.deepEqual(autoFloor(a, room), autoFloor([...a].reverse(), room));
});

test("too many for the room: the drawn room grows; none outside it", () => {
  const many = Array.from({ length: 40 }, (_, i) => t(`m${i}`, `T${i + 1}`, 2, 2));
  const { room: drawn, places } = autoFloor(many, room);
  assert.ok(drawn.heightM > room.heightM && drawn.widthM === room.widthM);
  for (const p of Object.values(places)) assert.ok(p.x + p.w <= drawn.widthM + 1e-9 && p.y + p.h <= drawn.heightM + 1e-9);
  const wide = autoFloor([t("w", "W1", 14, 1)], room);
  assert.ok(wide.room.widthM >= 14 + 2 * AUTO_MARGIN_M - 1e-9, "a table wider than the room");
});

test("no tables: the room as it is; saved means the editor saved it", () => {
  assert.deepEqual(autoFloor([], room), { room, places: {} });
  assert.equal(planSaved(null), false);
  assert.equal(planSaved(undefined), false);
  assert.equal(planSaved(new Date()), true);
  assert.ok(AUTO_GAP_M > 0);
});
