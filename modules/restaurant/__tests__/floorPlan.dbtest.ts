// The floor plan's schema against a real database (the editor, Step 1):
// a new table is shaped by its seats and placed in a free grid slot of its
// area (the area's layout version moves on); table numbers are unique across
// the business among live tables; fixtures in metres; one active event
// layout per area. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/floorPlan.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { placeInArea } from "../server/services/tables";
import { saveFloorPlan } from "../server/services/floorPlan";
import { getFloorEditor } from "../server/queries/floorPlan";
import { getFloor } from "../server/queries/floor";
import { autoFloor } from "../lib/floorAuto";
import type { FloorAreaPlan } from "../schemas/floorPlan";
import { todayInAppZone } from "@/lib/dateRanges";
import { appDateTime } from "../lib/time";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let areaA = "";
let areaB = "";
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const unique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

describe("Floor plan schema (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaA = (await prisma.diningArea.create({ data: { name: `Plan A ${stamp}`, warehouseId }, select: { id: true } })).id;
    areaB = (await prisma.diningArea.create({ data: { name: `Plan B ${stamp}`, warehouseId }, select: { id: true } })).id;
  });
  after(() => prisma.$disconnect());

  const add = (name: string, seats: number, areaId = areaA) =>
    prisma.$transaction(async (tx) => tx.table.create({ data: { name, seats, areaId, qrToken: newQrToken(), ...(await placeInArea(tx, areaId, seats)) } }));

  test("a new area: a 12 × 8 m room, a 0.5 m grid, the tracing image faded, version 0, unlocked", async () => {
    const area = await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } });
    assert.deepEqual(
      [Number(area.roomWidthM), Number(area.roomHeightM), Number(area.gridSizeM), Number(area.backgroundOpacity), area.layoutVersion, area.isLocked, area.backgroundImage],
      [12, 8, 0.5, 0.35, 0, false, null],
    );
  });

  test("new tables: shaped by their seats, in the first free grid slot; the layout version moves on", async () => {
    const two = await add(`P${stamp}1`, 2);
    const eight = await add(`P${stamp}2`, 8);
    assert.deepEqual([two.shape, Number(two.x), Number(two.y), Number(two.w)], ["ROUND", 0.4, 0.4, 1.2]);
    assert.deepEqual([eight.shape, Number(eight.x), Number(eight.y), Number(eight.w), Number(eight.h)], ["RECT", 4.2, 0.4, 3.2, 1.6]);
    // Someone drags a table onto the third slot: the next new one skips it.
    await prisma.table.update({ where: { id: two.id }, data: { x: 8.1, y: 0.5 } });
    const third = await add(`P${stamp}3`, 4);
    assert.deepEqual([Number(third.x), Number(third.y)], [0.4, 0.4], "the first slot is free again");
    const fourth = await add(`P${stamp}4`, 4);
    assert.deepEqual([Number(fourth.x), Number(fourth.y)], [0.4, 2.6], "slots 2 and 3 are taken");
    assert.equal((await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).layoutVersion, 4);
  });

  test("a full room grows to fit the next table", async () => {
    for (let i = 5; i <= 13; i++) await add(`P${stamp}${i}`, 4);
    const area = await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA }, include: { tables: true } });
    const deepest = Math.max(...area.tables.map((t) => Number(t.y) + Number(t.h)));
    assert.ok(Number(area.roomHeightM) >= deepest, `room ${area.roomHeightM} m, deepest table ${deepest} m`);
  });

  test("table numbers are unique across all areas among live tables (any case); a deleted one's number is free", async () => {
    await add(`Q${stamp}`, 4, areaA);
    await assert.rejects(() => add(`q${stamp}`, 4, areaB), unique, "another area, other case: refused");
    await prisma.table.updateMany({ where: { name: `Q${stamp}` }, data: { deletedAt: new Date() } });
    const again = await add(`Q${stamp}`, 4, areaB);
    assert.equal(again.areaId, areaB);
  });

  test("fixtures: in metres on an area, soft-deleted", async () => {
    const pass = await prisma.floorFixture.create({ data: { areaId: areaA, type: "KITCHEN_PASS", label: "Kitchen pass", x: 9, y: 3.5, w: 2.8, h: 1, rotation: 90 } });
    assert.deepEqual([pass.type, Number(pass.w), pass.rotation, pass.deletedAt], ["KITCHEN_PASS", 2.8, 90, null]);
  });

  test("event layouts: at most one active per area", async () => {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const wedding = await prisma.floorLayout.create({ data: { areaId: areaA, name: "Wedding", snapshot: { tables: [], fixtures: [] }, isActive: true, createdById: user.id } });
    const party = await prisma.floorLayout.create({ data: { areaId: areaA, name: "Party", snapshot: { tables: [], fixtures: [] }, createdById: user.id } });
    await assert.rejects(() => prisma.floorLayout.update({ where: { id: party.id }, data: { isActive: true } }), unique);
    // Another area's active layout is no clash.
    await prisma.floorLayout.create({ data: { areaId: areaB, name: "Wedding", snapshot: {}, isActive: true, createdById: user.id } });
    await prisma.$transaction([prisma.floorLayout.update({ where: { id: wedding.id }, data: { isActive: false } }), prisma.floorLayout.update({ where: { id: party.id }, data: { isActive: true } })]);
    assert.deepEqual((await prisma.floorLayout.findMany({ where: { areaId: areaA, isActive: true } })).map((l) => l.name), ["Party"]);
  });

  // ---- Saving from the editor (Step 2)
  // An area as the editor would send it back, changed by `edit`.
  const plan = async (areaId: string, edit: (p: FloorAreaPlan) => FloorAreaPlan = (p) => p): Promise<FloorAreaPlan> => {
    const area = (await getFloorEditor()).find((a) => a.id === areaId)!;
    return edit({
      areaId,
      layoutVersion: area.layoutVersion,
      // As the editor sends it (a never-saved area's grid may need a bigger room).
      room: area.room,
      tables: area.tables.map(({ id, name, seats, shape, x, y, w, h, rotation }) => ({ id, name, seats, shape, x, y, w, h, rotation })),
      fixtures: area.fixtures.map(({ id, type, label, x, y, w, h, rotation }) => ({ id, type, label, x, y, w, h, rotation })),
    });
  };
  const snapshot = async (areaId: string) =>
    JSON.stringify(await prisma.diningArea.findUnique({ where: { id: areaId }, select: { layoutVersion: true, tables: { where: { deletedAt: null }, orderBy: { id: "asc" } }, fixtures: { where: { deletedAt: null }, orderBy: { id: "asc" } } } }));

  test("save: tables moved, turned and renumbered, one added, a fixture added — one transaction, the version moves on", async () => {
    const area = await prisma.diningArea.create({ data: { name: `Plan S ${stamp}`, warehouseId: (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId }, select: { id: true } });
    await add(`S${stamp}1`, 4, area.id);
    await add(`S${stamp}2`, 2, area.id);
    const before = await plan(area.id);
    const result = await saveFloorPlan({
      areas: [
        {
          ...before,
          tables: [
            { ...before.tables[0], x: 6, y: 5, rotation: 45 },
            { ...before.tables[1], name: `S${stamp}9`, seats: 3 },
            { name: `S${stamp}3`, seats: 6, shape: "BOOTH", x: 1, y: 5, w: 2.2, h: 1.6, rotation: 0 },
          ],
          fixtures: [{ type: "ENTRANCE", label: "Front door", x: 9, y: 7.5, w: 2.4, h: 0.5, rotation: 0 }],
        },
      ],
    });
    assert.ok(result.ok, JSON.stringify(result));
    const after = (await getFloorEditor()).find((a) => a.id === area.id)!;
    assert.equal(result.ok && result.versions[area.id], before.layoutVersion + 1);
    assert.equal(after.layoutVersion, before.layoutVersion + 1);
    assert.deepEqual(after.tables.map((t) => [t.name, t.seats, t.shape, t.x, t.y, t.rotation]).sort(), [
      [`S${stamp}1`, 4, "SQUARE", 6, 5, 45],
      [`S${stamp}3`, 6, "BOOTH", 1, 5, 0],
      // Left where the editor opened it: never saved there, so the grid (6g follow-up 3).
      [`S${stamp}9`, 3, "ROUND", before.tables[1].x, before.tables[1].y, 0],
    ].sort());
    assert.ok((await prisma.table.findFirstOrThrow({ where: { name: `S${stamp}3` } })).qrToken, "a new table gets its QR token");
    assert.deepEqual(after.fixtures.map((f) => [f.type, f.label]), [["ENTRANCE", "Front door"]]);

    // Taken off the plan: tables and fixtures soft-deleted.
    const next = await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.filter((t) => t.name !== `S${stamp}3`), fixtures: [] }))] });
    assert.ok(next.ok);
    assert.ok((await prisma.table.findFirstOrThrow({ where: { name: `S${stamp}3` } })).deletedAt);
    assert.equal(await prisma.floorFixture.count({ where: { areaId: area.id, deletedAt: null } }), 0);
  });

  test("refused, with nothing written: an old version, a locked area, overlapping tables, outside the room, a number used elsewhere", async () => {
    const start = await snapshot(areaA);
    const stale = await saveFloorPlan({ areas: [await plan(areaA, (p) => ({ ...p, layoutVersion: p.layoutVersion - 1, tables: p.tables.map((t, i) => (i === 0 ? { ...t, x: 0 } : t)) }))] });
    assert.ok(!stale.ok && stale.stale && /changed elsewhere/.test(stale.error), JSON.stringify(stale));

    const overlap = await saveFloorPlan({ areas: [await plan(areaA, (p) => ({ ...p, tables: p.tables.map((t, i) => (i < 2 ? { ...t, x: 5, y: 5, rotation: 0 } : t)) }))] });
    assert.ok(!overlap.ok && /overlap/.test(overlap.error), JSON.stringify(overlap));

    const outside = await saveFloorPlan({ areas: [await plan(areaA, (p) => ({ ...p, tables: p.tables.map((t, i) => (i === 0 ? { ...t, x: 99 } : t)) }))] });
    assert.ok(!outside.ok && /outside/.test(outside.error), JSON.stringify(outside));

    const taken = (await prisma.table.findFirstOrThrow({ where: { areaId: areaB, deletedAt: null }, select: { name: true } })).name;
    const clash = await saveFloorPlan({ areas: [await plan(areaA, (p) => ({ ...p, tables: p.tables.map((t, i) => (i === 0 ? { ...t, name: taken.toLowerCase() } : t)) }))] });
    assert.ok(!clash.ok && /already used/.test(clash.error), JSON.stringify(clash));

    await prisma.diningArea.update({ where: { id: areaA }, data: { isLocked: true } });
    const locked = await saveFloorPlan({ areas: [await plan(areaA)] });
    assert.ok(!locked.ok && /locked/.test(locked.error));
    await prisma.diningArea.update({ where: { id: areaA }, data: { isLocked: false } });

    assert.equal(await snapshot(areaA), start, "nothing written by any of them");
  });

  test("a table with an open order, or a booking today, can't be taken off the plan", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaB } })).warehouseId;
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const busy = await add(`O${stamp}`, 4, areaB);
    await prisma.order.create({ data: { type: "DINE_IN", status: "OPEN", tableId: busy.id, warehouseId, checkNumber: 1 } });
    const refused = await saveFloorPlan({ areas: [await plan(areaB, (p) => ({ ...p, tables: p.tables.filter((t) => t.id !== busy.id) }))] });
    assert.ok(!refused.ok && /open order/.test(refused.error), JSON.stringify(refused));

    const booked = await add(`R${stamp}`, 4, areaB);
    await prisma.reservation.create({ data: { tableId: booked.id, guestName: "Okafor", guestPhone: "0", partySize: 4, startsAt: appDateTime(todayInAppZone(), "23:30"), createdById: user.id } });
    const refused2 = await saveFloorPlan({ areas: [await plan(areaB, (p) => ({ ...p, tables: p.tables.filter((t) => t.id !== booked.id) }))] });
    assert.ok(!refused2.ok && /booking today/.test(refused2.error), JSON.stringify(refused2));
    assert.equal(await prisma.table.count({ where: { id: { in: [busy.id, booked.id] }, deletedAt: null } }), 2);
  });

  test("room size (Step 3): saved with the plan; it can't shrink past what's in it; left out, it's unchanged", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId;
    const area = await prisma.diningArea.create({ data: { name: `Plan R ${stamp}`, warehouseId }, select: { id: true } });
    const table = await add(`Z${stamp}1`, 4, area.id);
    assert.ok((await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t) => ({ ...t, x: 9, y: 6 })) }))] })).ok);
    const room = async () => (await getFloorEditor()).find((a) => a.id === area.id)!.room;

    const grown = await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, room: { widthM: 14.5, heightM: 9, gridM: 0.25 } }))] });
    assert.ok(grown.ok, JSON.stringify(grown));
    assert.deepEqual(await room(), { widthM: 14.5, heightM: 9, gridM: 0.25 });

    // The table's right edge is at 10.4 m: a 10 m room would cut it off.
    const start = await snapshot(area.id);
    const shrunk = await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, room: { widthM: 10, heightM: 9, gridM: 0.25 } }))] });
    assert.ok(!shrunk.ok && shrunk.error.includes(`can't be 10 × 9 m: Table Z${stamp}1 would be outside it`), JSON.stringify(shrunk));
    assert.deepEqual(await room(), { widthM: 14.5, heightM: 9, gridM: 0.25 }, "the room is as it was");
    assert.equal(await snapshot(area.id), start, "nothing written");

    // Down to its edge is fine (touching the wall is inside).
    assert.ok((await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, room: { widthM: 10.4, heightM: 7.4, gridM: 0.5 } }))] })).ok);
    assert.deepEqual(await room(), { widthM: 10.4, heightM: 7.4, gridM: 0.5 });
    // A save without a room leaves it alone.
    assert.ok((await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t) => ({ ...t, seats: 5 })) }))] })).ok);
    assert.deepEqual(await room(), { widthM: 10.4, heightM: 7.4, gridM: 0.5 });
    assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).seats, 5);
  });

  // ---- Step 4: publish
  test("save: logged as who did it (from → to, what changed); new items' ids come back by key", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId;
    const area = await prisma.diningArea.create({ data: { name: `Plan P ${stamp}`, warehouseId }, select: { id: true } });
    const user = await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    await add(`Q${stamp}1`, 4, area.id);
    const before = await plan(area.id);
    const result = await saveFloorPlan(
      {
        areas: [
          {
            ...before,
            tables: [...before.tables, { key: "new-7", name: `Q${stamp}2`, seats: 2, shape: "ROUND", x: 6, y: 6, w: 1.2, h: 1.2, rotation: 0 }],
            fixtures: [{ key: "new-8", type: "PILLAR", label: "Pillar", x: 3, y: 3, w: 0.5, h: 0.5, rotation: 0 }],
          },
        ],
      },
      user.id,
    );
    assert.ok(result.ok, JSON.stringify(result));
    const table = await prisma.table.findFirstOrThrow({ where: { name: `Q${stamp}2`, deletedAt: null } });
    const fixture = await prisma.floorFixture.findFirstOrThrow({ where: { areaId: area.id, deletedAt: null } });
    assert.deepEqual(result.created, { "new-7": table.id, "new-8": fixture.id });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: area.id, action: "floor.layout.save" }, orderBy: { createdAt: "desc" } });
    assert.equal(log.userId, user.id);
    assert.deepEqual(log.meta, {
      area: `Plan P ${stamp}`,
      from: before.layoutVersion,
      to: before.layoutVersion + 1,
      tables: { count: 2, added: 1, changed: 1, restored: 0, removed: 0 },
      fixtures: { count: 1, removed: 0 },
      // The editor sends its room with every save.
      room: before.room,
    });
  });

  test("stale: names who saved it — 'Layout changed by Grace M. Reload?' — or says elsewhere when it wasn't the editor", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId;
    const area = await prisma.diningArea.create({ data: { name: `Plan G ${stamp}`, warehouseId }, select: { id: true } });
    const grace = await prisma.user.create({ data: { firstName: "Grace", lastName: "Mensah", email: `grace-${stamp}@example.test`, password: "x" }, select: { id: true } });
    await add(`G${stamp}1`, 4, area.id);
    const mine = await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t) => ({ ...t, x: 2 })) }));
    const theirs = await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t) => ({ ...t, x: 5 })) }))] }, grace.id);
    assert.ok(theirs.ok);
    const refused = await saveFloorPlan({ areas: [mine] }, null);
    assert.deepEqual(refused, { ok: false, error: "Layout changed by Grace M. Reload?", stale: true, areaId: area.id });
    assert.equal((await prisma.table.findFirstOrThrow({ where: { name: `G${stamp}1` } })).x.toString(), "5", "hers stands");

    // A table added on the Tables screen moves the version on too — no name to give.
    const fresh = await plan(area.id);
    await add(`G${stamp}2`, 2, area.id);
    const elsewhere = await saveFloorPlan({ areas: [fresh] });
    assert.ok(!elsewhere.ok && elsewhere.error === `Layout changed elsewhere (now v${fresh.layoutVersion + 1}). Reload?`, JSON.stringify(elsewhere));
  });

  test("undo after a save: a table taken off comes back as the same table (its QR code kept); two tables can swap numbers", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId;
    const area = await prisma.diningArea.create({ data: { name: `Plan U ${stamp}`, warehouseId }, select: { id: true } });
    const one = await add(`U${stamp}1`, 4, area.id);
    const two = await add(`U${stamp}2`, 4, area.id);
    const full = await plan(area.id);
    assert.ok((await saveFloorPlan({ areas: [{ ...full, tables: full.tables.filter((t) => t.id !== two.id) }] })).ok);
    assert.ok((await prisma.table.findUniqueOrThrow({ where: { id: two.id } })).deletedAt);
    // Undo: the editor sends it again, id and all.
    const back = await saveFloorPlan({ areas: [{ ...full, layoutVersion: full.layoutVersion + 1 }] });
    assert.ok(back.ok, JSON.stringify(back));
    const restored = await prisma.table.findUniqueOrThrow({ where: { id: two.id } });
    assert.deepEqual([restored.deletedAt, restored.qrToken, restored.name], [null, two.qrToken, `U${stamp}2`]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: area.id, action: "floor.layout.save" }, orderBy: { createdAt: "desc" } });
    assert.equal((log.meta as { tables: { restored: number } }).tables.restored, 1);

    const swap = await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t) => ({ ...t, name: t.id === one.id ? `U${stamp}2` : `U${stamp}1` })) }))] });
    assert.ok(swap.ok, JSON.stringify(swap));
    assert.deepEqual(
      [(await prisma.table.findUniqueOrThrow({ where: { id: one.id } })).name, (await prisma.table.findUniqueOrThrow({ where: { id: two.id } })).name],
      [`U${stamp}2`, `U${stamp}1`],
    );
  });

  test("the editor is told which tables can't be taken off, and why", async () => {
    const editor = (await getFloorEditor()).find((a) => a.id === areaB)!;
    const busy = Object.fromEntries(editor.tables.filter((t) => t.busy).map((t) => [t.name, t.busy]));
    assert.match(busy[`O${stamp}`] ?? "", /has an open order, so it can't be removed/);
    assert.match(busy[`R${stamp}`] ?? "", /has a booking today \(Okafor at 23:30\)/);
    assert.ok(editor.tables.some((t) => t.busy === null), "the others are free");
  });

  // 6g follow-up 3: an area never saved in the editor gets its tables drawn
  // in a neat grid by number — the same grid on every floor and in the
  // editor — until a save there stores real places.
  test("never saved in the editor: every floor and the editor draw the same grid by number; a save makes the places real", async () => {
    const warehouseId = (await prisma.diningArea.findUniqueOrThrow({ where: { id: areaA } })).warehouseId;
    const area = await prisma.diningArea.create({ data: { name: `Plan G ${stamp}`, warehouseId }, select: { id: true } });
    // Added on the Tables page, out of order: layoutVersion moves on, but it isn't saved in the editor.
    for (const n of [3, 1, 10, 2]) await add(`G${stamp}-${n}`, n === 10 ? 8 : 4, area.id);
    const row = await prisma.diningArea.findUniqueOrThrow({ where: { id: area.id }, select: { layoutVersion: true, floorPlanSavedAt: true, roomWidthM: true, roomHeightM: true } });
    assert.ok(row.layoutVersion > 0 && row.floorPlanSavedAt === null, "tables added: the version moved, still never saved");

    const floor = await getFloor(area.id);
    const editor = (await getFloorEditor()).find((a) => a.id === area.id)!;
    const stored = await prisma.table.findMany({ where: { areaId: area.id, deletedAt: null }, select: { id: true, name: true, w: true, h: true } });
    const expected = autoFloor(stored.map((t) => ({ id: t.id, name: t.name, w: Number(t.w), h: Number(t.h) })), { widthM: Number(row.roomWidthM), heightM: Number(row.roomHeightM) });
    assert.equal(floor.planSaved, false);
    for (const t of floor.tables) assert.deepEqual({ x: t.place.x, y: t.place.y, w: t.place.w, h: t.place.h, rotation: t.place.rotation }, expected.places[t.id], `${t.name} on the floor`);
    for (const t of editor.tables) assert.deepEqual({ x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation }, expected.places[t.id], `${t.name} in the editor`);
    assert.deepEqual([editor.room.widthM, editor.room.heightM], [floor.room?.widthM, floor.room?.heightM], "the same room");
    const mid = (t: (typeof floor.tables)[number]) => Math.round((t.place.y + t.place.h / 2) * 10);
    const order = [...floor.tables].sort((a, b) => mid(a) - mid(b) || a.place.x - b.place.x).map((t) => t.name.split("-")[1]);
    assert.deepEqual(order, ["1", "2", "3", "10"], "by table number, left to right, top to bottom");

    // Saved from the editor as it opened: those places are stored, and real from now on.
    assert.ok((await saveFloorPlan({ areas: [await plan(area.id, (p) => ({ ...p, tables: p.tables.map((t, i) => (i === 0 ? { ...t, x: t.x + 0.1 } : t)) }))] }, (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id)).ok);
    const after = await prisma.diningArea.findUniqueOrThrow({ where: { id: area.id }, select: { floorPlanSavedAt: true } });
    assert.ok(after.floorPlanSavedAt instanceof Date, "saved in the editor");
    const saved = await getFloor(area.id);
    assert.equal(saved.planSaved, true);
    const db = await prisma.table.findMany({ where: { areaId: area.id, deletedAt: null }, select: { id: true, x: true, y: true } });
    for (const t of saved.tables) {
      const d = db.find((x) => x.id === t.id)!;
      assert.deepEqual([t.place.x, t.place.y], [Number(d.x), Number(d.y)], `${t.name}: the stored place`);
    }
    // A table added on the Tables page afterwards keeps the saved plan.
    await add(`G${stamp}-4`, 2, area.id);
    assert.equal((await getFloor(area.id)).planSaved, true);
  });
});
