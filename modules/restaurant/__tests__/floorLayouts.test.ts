// Run with: npx tsx --test modules/restaurant/__tests__/floorLayouts.test.ts
// Event layouts (Part 7 Step 5), without a database: what a snapshot holds,
// how it's summed up, and the names a layout can have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutKey, layoutSnapshotSchema, NORMAL_NAME, snapshotSummary } from "../lib/floorLayouts";
import { floorLayoutSaveSchema, floorLayoutSwitchSchema } from "../schemas/floorPlan";

const snapshot = {
  v: 1,
  kind: "event",
  room: { widthM: 12, heightM: 8, gridM: 0.5 },
  tables: [
    { id: "t1", name: "T1", seats: 10, shape: "RECT", x: 1, y: 1, w: 3.2, h: 1.6, rotation: 0 },
    { id: "t2", name: "T2", seats: 1, shape: "ROUND", x: 6, y: 1, w: 1.2, h: 1.2, rotation: 45 },
  ],
  fixtures: [{ id: "f1", type: "STAGE", label: "Stage", x: 8, y: 5, w: 3, h: 2, rotation: 0 }],
};

test("a snapshot: the room, the tables and fixtures with their ids — anything else is refused when read back", () => {
  assert.ok(layoutSnapshotSchema.safeParse(snapshot).success);
  assert.ok(!layoutSnapshotSchema.safeParse({ ...snapshot, v: 2 }).success, "an unknown version");
  assert.ok(!layoutSnapshotSchema.safeParse({ ...snapshot, tables: [{ name: "T1" }] }).success, "a table without its geometry");
  assert.ok(!layoutSnapshotSchema.safeParse({ ...snapshot, fixtures: [{ ...snapshot.fixtures[0], type: "SOFA" }] }).success, "an unknown fixture");
  assert.ok(!layoutSnapshotSchema.safeParse(null).success);
});

test("summed up as tables and seats", () => {
  assert.equal(snapshotSummary(snapshot as never), "2 tables · 11 seats");
  assert.equal(snapshotSummary({ tables: [snapshot.tables[1]] } as never), "1 table · 1 seat");
});

test("a layout's name: 1–40 characters, trimmed, not the everyday floor's own (any case)", () => {
  const name = (value: string) => floorLayoutSaveSchema.safeParse({ areaId: "a", name: value });
  assert.equal(name("  Wedding setup ").data?.name, "Wedding setup");
  assert.equal(name("   ").error?.issues[0]?.message, "Give the layout a name.");
  assert.equal(name("x".repeat(41)).error?.issues[0]?.message, "A layout name is at most 40 characters.");
  assert.match(name(" normal LAYOUT ").error?.issues[0]?.message ?? "", /everyday floor/);
  assert.equal(layoutKey(" Wedding Setup "), layoutKey("wedding setup"));
  assert.equal(NORMAL_NAME, "Normal layout");
});

test("switching: to a saved layout, or null for the normal floor, from the version shown", () => {
  assert.ok(floorLayoutSwitchSchema.safeParse({ areaId: "a", layoutVersion: 3, layoutId: "l1" }).success);
  assert.ok(floorLayoutSwitchSchema.safeParse({ areaId: "a", layoutVersion: 3, layoutId: null }).success);
  assert.ok(!floorLayoutSwitchSchema.safeParse({ areaId: "a", layoutId: "l1" }).success, "the version is required");
});
