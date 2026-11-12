// Event layouts (Part 7 Step 5) against a real database: Save as layout,
// Switch layout (the everyday floor kept as "normal"), SAVE keeping the
// layout on the floor up to date, Restore normal (the same tables back),
// switching refused — an open order, a booking today, a stale version, a
// locked area — with nothing changed, and deleting. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/floorLayouts.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { todayInAppZone } from "@/lib/dateRanges";
import { newQrToken } from "../lib/qrToken";
import { appDateTime } from "../lib/time";
import { placeInArea } from "../server/services/tables";
import { saveFloorPlan } from "../server/services/floorPlan";
import { deleteFloorLayout, saveFloorLayout, switchFloorLayout } from "../server/services/floorLayouts";
import { getFloorEditor } from "../server/queries/floorPlan";
import { getFloor } from "../server/queries/floor";
import type { FloorAreaPlan } from "../schemas/floorPlan";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const stamp = Date.now().toString(36).slice(-4).toUpperCase();
let areaId = "";
let warehouseId = "";
let userId = "";
const ids: Record<string, string> = {};

const editorArea = async () => (await getFloorEditor()).find((a) => a.id === areaId)!;
const plan = async (edit: (p: FloorAreaPlan) => FloorAreaPlan = (p) => p): Promise<FloorAreaPlan> => {
  const area = await editorArea();
  return edit({
    areaId,
    layoutVersion: area.layoutVersion,
    tables: area.tables.map(({ id, name, seats, shape, x, y, w, h, rotation }) => ({ id, name, seats, shape, x, y, w, h, rotation })),
    fixtures: area.fixtures.map(({ id, type, label, x, y, w, h, rotation }) => ({ id, type, label, x, y, w, h, rotation })),
  });
};
const floorNow = async () => (await prisma.table.findMany({ where: { areaId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, x: true, seats: true } })).map((t) => [t.name, Number(t.x), t.seats]);
const layoutRows = () => prisma.floorLayout.findMany({ where: { areaId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, isActive: true, snapshot: true } });
const version = async () => (await editorArea()).layoutVersion;

describe("Event layouts (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: `Events ${stamp}`, warehouseId }, select: { id: true } })).id;
    for (const [key, seats] of [["E1", 4], ["E2", 4], ["E3", 2]] as const) {
      const name = `${key}${stamp}`;
      ids[key] = (await prisma.$transaction(async (tx) => tx.table.create({ data: { name, seats, areaId, qrToken: newQrToken(), ...(await placeInArea(tx, areaId, seats)) } }))).id;
    }
  });
  after(() => prisma.$disconnect());

  test("Save as layout: the floor as saved, under a name; the same name again needs Replace", async () => {
    const saved = await saveFloorLayout({ areaId, name: "Every day copy" }, userId);
    assert.ok(saved.ok);
    // Rearrange into the wedding floor and keep that too: one long table for 10 instead of E2 and E3.
    const wedding = await saveFloorPlan({
      areas: [
        await plan((p) => ({
          ...p,
          tables: [
            ...p.tables.filter((t) => t.name.startsWith("E1")),
            { key: "k", name: `W1${stamp}`, seats: 10, shape: "RECT", x: 4, y: 4, w: 3.2, h: 1.6, rotation: 0 },
          ],
        })),
      ],
    }, userId);
    assert.ok(wedding.ok, JSON.stringify(wedding));
    ids.W1 = wedding.ok ? wedding.created.k : "";
    assert.ok((await saveFloorLayout({ areaId, name: "Wedding setup" }, userId)).ok);
    const again = await saveFloorLayout({ areaId, name: " wedding SETUP " }, userId);
    assert.deepEqual(again, { ok: false, error: "There's already a layout called “Wedding setup”.", exists: true });
    const replaced = await saveFloorLayout({ areaId, name: "Wedding setup", replace: true }, userId);
    assert.ok(replaced.ok && replaced.replaced);
    const area = await editorArea();
    assert.deepEqual(area.layouts.map((l) => [l.name, l.isActive, l.summary]).sort(), [["Every day copy", false, "3 tables · 10 seats"], ["Wedding setup", false, "2 tables · 14 seats"]]);
    assert.equal(area.hasNormal, false);
    assert.equal(await prisma.auditLog.count({ where: { entityId: areaId, action: "floor.layout.saveAs" } }), 3);
  });

  test("Switch layout: the chosen one on the floor (the same tables back, by id); the everyday floor kept as normal; logged", async () => {
    // The floor is the wedding one now; go back to the every-day copy as an event layout first.
    const copy = (await editorArea()).layouts.find((l) => l.name === "Every day copy")!;
    const before = await version();
    const switched = await switchFloorLayout({ areaId, layoutVersion: before, layoutId: copy.id }, userId);
    assert.ok(switched.ok, JSON.stringify(switched));
    assert.equal(switched.ok && switched.versions[areaId], before + 1);
    assert.deepEqual((await floorNow()).map(([name]) => name), [`E1${stamp}`, `E2${stamp}`, `E3${stamp}`]);
    const e2 = await prisma.table.findUniqueOrThrow({ where: { id: ids.E2 } });
    assert.equal(e2.deletedAt, null, "E2 came back as itself (same id, same QR code)");
    assert.ok((await prisma.table.findUniqueOrThrow({ where: { id: ids.W1 } })).deletedAt, "the wedding table is off the floor");

    const rows = await layoutRows();
    const normal = rows.find((r) => (r.snapshot as { kind: string }).kind === "normal")!;
    assert.equal(normal.name, "Normal layout");
    assert.deepEqual((normal.snapshot as { tables: { name: string }[] }).tables.map((t) => t.name).sort(), [`E1${stamp}`, `W1${stamp}`], "normal = what was on the floor");
    assert.deepEqual(rows.filter((r) => r.isActive).map((r) => r.name), ["Every day copy"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: areaId, action: "floor.layout.switch" }, orderBy: { createdAt: "desc" } });
    assert.deepEqual([(log.meta as Record<string, unknown>).fromLayout, (log.meta as Record<string, unknown>).toLayout], ["Normal layout", "Every day copy"]);

    // On the service screens: the area says which layout is on.
    assert.equal((await getFloor(areaId)).areas.find((a) => a.id === areaId)?.layout, "Every day copy");
  });

  test("SAVE while an event layout is on keeps that layout up to date", async () => {
    assert.ok((await saveFloorPlan({ areas: [await plan((p) => ({ ...p, tables: p.tables.map((t) => (t.id === ids.E3 ? { ...t, seats: 3 } : t)) }))] }, userId)).ok);
    const copy = (await layoutRows()).find((r) => r.name === "Every day copy")!;
    assert.equal((copy.snapshot as { tables: { id: string; seats: number }[] }).tables.find((t) => t.id === ids.E3)?.seats, 3);
  });

  test("refused, nothing changed: a table it would take away has an open order (or a booking today); a stale version; a locked area", async () => {
    const wedding = (await editorArea()).layouts.find((l) => l.name === "Wedding setup")!;
    const start = { floor: await floorNow(), layouts: JSON.stringify(await layoutRows()), version: await version() };
    const order = await prisma.order.create({ data: { type: "DINE_IN", status: "OPEN", tableId: ids.E2, warehouseId, checkNumber: 1 }, select: { id: true } });
    const busy = await switchFloorLayout({ areaId, layoutVersion: start.version, layoutId: wedding.id }, userId);
    assert.deepEqual(busy, { ok: false, error: `Can't switch to “Wedding setup”: Table E2${stamp} has an open order, so it can't be removed. Close or move the order first.` });
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED", deletedAt: new Date() } });

    await prisma.reservation.create({ data: { tableId: ids.E3, guestName: "Okafor", guestPhone: "0", partySize: 2, startsAt: appDateTime(todayInAppZone(), "23:45"), createdById: userId, id: `res${stamp}` } });
    const booked = await switchFloorLayout({ areaId, layoutVersion: start.version, layoutId: wedding.id }, userId);
    assert.ok(!booked.ok && booked.error.startsWith(`Can't switch to “Wedding setup”: Table E3${stamp} has a booking today (Okafor at 23:45)`), JSON.stringify(booked));
    await prisma.reservation.delete({ where: { id: `res${stamp}` } });

    const stale = await switchFloorLayout({ areaId, layoutVersion: start.version - 1, layoutId: wedding.id }, userId);
    assert.ok(!stale.ok && stale.stale && stale.areaId === areaId && /^Layout changed by .+ Reload\?$/.test(stale.error), JSON.stringify(stale));

    await prisma.diningArea.update({ where: { id: areaId }, data: { isLocked: true } });
    const locked = await switchFloorLayout({ areaId, layoutVersion: start.version, layoutId: wedding.id }, userId);
    assert.ok(!locked.ok && locked.error === `Can't switch to “Wedding setup”: Events ${stamp} is locked. Unlock it to change its layout.`, JSON.stringify(locked));
    await prisma.diningArea.update({ where: { id: areaId }, data: { isLocked: false } });

    assert.deepEqual({ floor: await floorNow(), layouts: JSON.stringify(await layoutRows()), version: await version() }, start);
  });

  test("event → event: the kept normal floor stays as it was", async () => {
    const normalBefore = (await layoutRows()).find((r) => r.name === "Normal layout")!;
    const wedding = (await editorArea()).layouts.find((l) => l.name === "Wedding setup")!;
    const switched = await switchFloorLayout({ areaId, layoutVersion: await version(), layoutId: wedding.id }, userId);
    assert.ok(switched.ok, JSON.stringify(switched));
    assert.deepEqual((await floorNow()).map(([name, , seats]) => [name, seats]), [[`E1${stamp}`, 4], [`W1${stamp}`, 10]]);
    const normal = (await layoutRows()).find((r) => r.name === "Normal layout")!;
    assert.deepEqual([normal.id, JSON.stringify(normal.snapshot)], [normalBefore.id, JSON.stringify(normalBefore.snapshot)]);
    const again = await switchFloorLayout({ areaId, layoutVersion: await version(), layoutId: wedding.id }, userId);
    assert.deepEqual(again, { ok: false, error: "Can't switch to “Wedding setup”: “Wedding setup” is already on the floor." });
  });

  test("delete: not the one on the floor; another one goes (logged)", async () => {
    const area = await editorArea();
    const on = area.layouts.find((l) => l.isActive)!;
    const off = area.layouts.find((l) => !l.isActive)!;
    const refused = await deleteFloorLayout({ layoutId: on.id }, userId);
    assert.ok(!refused.ok && /is on the floor/.test(refused.error));
    assert.ok((await deleteFloorLayout({ layoutId: off.id }, userId)).ok);
    assert.deepEqual((await editorArea()).layouts.map((l) => l.name), ["Wedding setup"]);
    assert.equal(await prisma.auditLog.count({ where: { entityId: areaId, action: "floor.layout.delete" } }), 1);
    const gone = await deleteFloorLayout({ layoutId: off.id }, userId);
    assert.deepEqual(gone, { ok: false, error: "That layout has already been deleted." });
  });

  test("Restore normal: the everyday floor back (the same tables), nothing active, the kept copy let go", async () => {
    const restored = await switchFloorLayout({ areaId, layoutVersion: await version(), layoutId: null }, userId);
    assert.ok(restored.ok, JSON.stringify(restored));
    assert.deepEqual((await floorNow()).map(([name]) => name), [`E1${stamp}`, `W1${stamp}`]);
    const rows = await layoutRows();
    assert.deepEqual(rows.map((r) => [r.name, r.isActive]), [["Wedding setup", false]]);
    assert.equal((await editorArea()).hasNormal, false);
    assert.equal((await getFloor(areaId)).areas.find((a) => a.id === areaId)?.layout, null);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { entityId: areaId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })).action, "floor.layout.restore");
    const twice = await switchFloorLayout({ areaId, layoutVersion: await version(), layoutId: null }, userId);
    assert.deepEqual(twice, { ok: false, error: "Can't switch to “Normal layout”: The normal layout is already on the floor." });
  });
});
