// Run with: npx tsx --test modules/restaurant/__tests__/floorView.test.ts
// The service view (Part 7 Step 6), without a browser: the room letterboxed
// into the panel, tables placed as a share of it (so the same layout keeps
// its proportions on any screen), turned tables, and the 64 px rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRoom, nameSize, placeIn, showsDetail, shownWidth, tableRadius } from "../lib/floorView";

const ROOM = { widthM: 12, heightM: 8 };

test("the room fills the panel as far as its shape allows — the spare space goes either side, or above and below", () => {
  // A wide panel: the room's height decides (24 px padding each side).
  assert.deepEqual(fitRoom(ROOM, { w: 1200, h: 448 }), { w: 600, h: 400, scale: 50 });
  // A tall panel: its width decides.
  assert.deepEqual(fitRoom(ROOM, { w: 648, h: 900 }), { w: 600, h: 400, scale: 50 });
  // Too small to draw: nothing (no negative sizes).
  assert.equal(fitRoom(ROOM, { w: 20, h: 20 }).scale, 0);
});

test("the same layout keeps its proportions at 1920×1080, 1366×768 and on a 10-inch tablet", () => {
  const table = { x: 3, y: 2, w: 1.4, h: 1.4, rotation: 0 };
  const panels = { "1920×1080": { w: 1500, h: 900 }, "1366×768": { w: 950, h: 590 }, "10-inch 1280×800": { w: 880, h: 620 } };
  const drawn = Object.values(panels).map((panel) => {
    const box = fitRoom(ROOM, panel);
    const px = (v: string, of: number) => (parseFloat(v) / 100) * of;
    const at = placeIn(table, ROOM);
    return { aspect: box.w / box.h, x: px(at.left, box.w) / box.w, y: px(at.top, box.h) / box.h, w: px(at.width, box.w) / box.w, square: px(at.width, box.w) / px(at.height, box.h) };
  });
  for (const d of drawn) {
    assert.ok(Math.abs(d.aspect - 1.5) < 1e-9, "the room is 12 : 8 everywhere");
    assert.ok(Math.abs(d.x - 0.25) < 1e-9 && Math.abs(d.y - 0.25) < 1e-9, "a quarter in from the left and top everywhere");
    assert.ok(Math.abs(d.square - 1) < 1e-9, "a square table stays square");
    assert.ok(Math.abs(d.w - drawn[0].w) < 1e-9);
  }
});

test("placed as a share of the room, turned as it was saved", () => {
  assert.deepEqual(placeIn({ x: 6, y: 4, w: 2.4, h: 1.6, rotation: 0 }, ROOM), { left: "50%", top: "50%", width: "20%", height: "20%" });
  assert.equal(placeIn({ x: 0, y: 0, w: 1, h: 1, rotation: 45 }, ROOM).transform, "rotate(45deg)");
});

test("how wide a table shows: on its side it's its depth; at 45° the narrower side", () => {
  const long = { x: 0, y: 0, w: 3.2, h: 1.2, rotation: 0 };
  assert.equal(shownWidth(long, 50), 160);
  assert.equal(shownWidth({ ...long, rotation: 90 }, 50), 60);
  assert.equal(shownWidth({ ...long, rotation: 270 }, 50), 60);
  assert.equal(shownWidth({ ...long, rotation: 135 }, 50), 60);
  assert.equal(shownWidth({ ...long, rotation: 180 }, 50), 160);
});

test("under 64 px wide: the number only; its size follows the table", () => {
  assert.equal(showsDetail(63.9), false);
  assert.equal(showsDetail(64), true);
  assert.equal(nameSize(40), 12);
  assert.equal(nameSize(70), 18);
  assert.equal(nameSize(200), 24);
});

test("shapes: round stays round, a booth's back is rounded, square corners shrink on a small table", () => {
  assert.equal(tableRadius("ROUND", 30), "50%");
  assert.equal(tableRadius("BOOTH", 150), "18px 18px 4px 4px");
  assert.equal(tableRadius("SQUARE", 120), "6px");
  assert.equal(tableRadius("RECT", 40), "2px");
});
