// Concurrency tests for the restaurant's write rules, against a real
// database: many requests at once, through the same functions the server
// actions call (server/services/*). They need a throwaway copy of the
// database and refuse to run anywhere else:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/concurrency.dbtest.ts
//
// (That tsconfig lets the server-only modules load outside Next.) Not part
// of the unit run: the file name doesn't end in .test.ts.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { addDays, todayInAppZone } from "@/lib/dateRanges";
import { newQrToken } from "../lib/qrToken";
import { ALREADY_OPEN, openTableOrder, TABLE_GONE } from "../server/services/floor";
import { bookTable, NOT_OPEN, seatBooking } from "../server/services/reservations";
import { replaceQrToken } from "../server/services/tables";
import { findTableByQrToken } from "../server/queries/tables";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { STALE } from "../server/services/orders";
import { mergeOrders, moveOrder, TAKEN } from "../server/services/tableMoves";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const AT_ONCE = 10;

let warehouseId = "";
let userId = "";
let areaId = "";
let tableCount = 0;
const dishIds: string[] = [];
let stockBefore: string[] = [];
const TOMORROW = addDays(todayInAppZone(), 1);

async function newTable(seats = 4) {
  tableCount += 1;
  return prisma.table.create({
    data: { name: `K${tableCount}`, seats, areaId, qrToken: newQrToken() },
    select: { id: true, name: true, qrToken: true },
  });
}

// An Open order on a new table, and its version.
async function newOrder() {
  const table = await newTable();
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  return { table, orderId: opened.orderId };
}
const versionOf = async (orderId: string) =>
  (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
const tapDish = async (orderId: string, productId: string) => {
  const result = await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null });
  assert.ok(result.ok, JSON.stringify(result));
};
const stockSnapshot = async () =>
  (await prisma.productStock.findMany({ select: { id: true, quantity: true }, orderBy: { id: "asc" } })).map((s) => `${s.id}:${s.quantity}`);

const booking = (tableId: string, time: string, guestName = "Okafor") => ({
  customerId: "",
  guestName,
  guestPhone: "0812 554 0192",
  partySize: 2,
  date: TOMORROW,
  time,
  tableId,
});

describe("restaurant concurrency (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const user = await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    warehouseId = warehouse.id;
    userId = user.id;
    areaId = (await prisma.diningArea.create({ data: { name: "Concurrency check", warehouseId }, select: { id: true } })).id;

    // Two menu items in stock for the order-screen tests.
    const brand = await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const category = await prisma.category.create({ data: { name: "Concurrency dishes" }, select: { id: true } });
    const stationId = async (code: string) => (await prisma.kitchenStation.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    for (const [name, prepStation, code] of [["Jollof", "KITCHEN", "KIT"], ["Chapman", "BAR", "BAR"]] as const) {
      const dish = await prisma.product.create({
        data: {
          name,
          code: `CC-${name}-${Date.now()}`,
          price: "18.00",
          categoryId: category.id,
          brandId: brand.id,
          unitId: unit.id,
          taxType: "EXCLUSIVE",
          productType: "MENU_ITEM",
          prepStation,
          stationId: await stationId(code),
        },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: dish.id, warehouseId, quantity: 50 } });
      dishIds.push(dish.id);
    }
    stockBefore = await stockSnapshot();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  describe("Open table", () => {
    for (const round of [1, 2, 3, 4, 5]) {
      test(`round ${round}: ${AT_ONCE} requests at once on one table → one order, the rest get the friendly error`, async () => {
        const table = await newTable();
        const results = await Promise.all(Array.from({ length: AT_ONCE }, () => openTableOrder(table.id, userId)));
        const opened = results.filter((r) => r.ok);
        const refused = results.filter((r) => !r.ok);
        assert.equal(opened.length, 1);
        const orderId = opened[0].ok ? opened[0].orderId : "";
        for (const r of refused) {
          assert.ok(!r.ok);
          assert.equal(r.error, ALREADY_OPEN);
          assert.equal(r.orderId, orderId, "points at the order that was opened");
        }
        assert.equal(await prisma.order.count({ where: { tableId: table.id } }), 1);
      });
    }

    test("a deleted table can't be opened", async () => {
      const table = await newTable();
      await prisma.table.update({ where: { id: table.id }, data: { deletedAt: new Date() } });
      assert.deepEqual(await openTableOrder(table.id, userId), { ok: false, error: TABLE_GONE });
    });
  });

  describe("Seat", () => {
    test("two devices seat the same booking at once → seated once, one order", async () => {
      const table = await newTable();
      assert.ok((await bookTable(booking(table.id, "19:30"), userId)).ok);
      const { id } = await prisma.reservation.findFirstOrThrow({ where: { tableId: table.id }, select: { id: true } });

      const results = await Promise.all([seatBooking(id, userId), seatBooking(id, userId)]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: NOT_OPEN });
      assert.equal(await prisma.order.count({ where: { tableId: table.id } }), 1);
      const winner = results.find((r) => r.ok);
      assert.ok(winner?.ok);
      const seated = await prisma.reservation.findUniqueOrThrow({ where: { id }, select: { status: true, orderId: true } });
      assert.deepEqual(seated, { status: "SEATED", orderId: winner.orderId });
    });

    test("Seat and Open table at once on the same table → exactly one order", async () => {
      const table = await newTable();
      assert.ok((await bookTable(booking(table.id, "20:00"), userId)).ok);
      const { id } = await prisma.reservation.findFirstOrThrow({ where: { tableId: table.id }, select: { id: true } });

      const [seat, open] = await Promise.all([seatBooking(id, userId), openTableOrder(table.id, userId)]);
      assert.equal([seat.ok, open.ok].filter(Boolean).length, 1, JSON.stringify({ seat, open }));
      assert.equal(await prisma.order.count({ where: { tableId: table.id } }), 1);
    });
  });

  describe("Bookings", () => {
    for (const round of [1, 2, 3]) {
      test(`round ${round}: ${AT_ONCE} bookings at once for the same slot → exactly one`, async () => {
        const table = await newTable();
        const results = await Promise.all(
          Array.from({ length: AT_ONCE }, (_, i) => bookTable(booking(table.id, "19:30", `Guest ${i}`), userId)),
        );
        assert.equal(results.filter((r) => r.ok).length, 1);
        for (const r of results.filter((x) => !x.ok)) {
          assert.ok(!r.ok);
          assert.equal(r.error, `${table.name} is already booked at 19:30.`);
        }
        assert.equal(await prisma.reservation.count({ where: { tableId: table.id } }), 1);
      });
    }

    test("clashing times at once (18:00, 19:00, 19:30, 20:15, 21:00) → never two within 2 hours", async () => {
      const table = await newTable();
      const times = ["18:00", "19:00", "19:30", "20:15", "21:00"];
      const results = await Promise.all(times.map((time) => bookTable(booking(table.id, time), userId)));
      // Whichever gets in first, at most two can stand together (18:00 with
      // 20:15 or 21:00, or 19:00 with 21:00 — exactly 2 hours is allowed);
      // no two booked ones may be under 2 hours apart.
      const booked = await prisma.reservation.findMany({ where: { tableId: table.id }, select: { startsAt: true } });
      assert.equal(results.filter((r) => r.ok).length, booked.length);
      for (const a of booked) {
        for (const b of booked) {
          if (a !== b) assert.ok(Math.abs(a.startsAt.getTime() - b.startsAt.getTime()) >= 120 * 60_000, "no two within 2 hours");
        }
      }
      assert.ok(booked.length >= 1 && booked.length <= 2);
    });

    test("the same slot on five different tables at once → all five booked (no false clash)", async () => {
      const tables = await Promise.all([newTable(), newTable(), newTable(), newTable(), newTable()]);
      const results = await Promise.all(tables.map((t) => bookTable(booking(t.id, "19:30"), userId)));
      assert.deepEqual(results, tables.map(() => ({ ok: true })));
    });
  });

  describe("QR token", () => {
    test("regenerating replaces the token: the old link finds nothing, the new one finds the table", async () => {
      const table = await newTable();
      assert.equal((await findTableByQrToken(table.qrToken))?.id, table.id);
      assert.equal(await replaceQrToken(table.id), true);
      const { qrToken } = await prisma.table.findUniqueOrThrow({ where: { id: table.id }, select: { qrToken: true } });
      assert.notEqual(qrToken, table.qrToken);
      assert.match(qrToken, /^[A-Za-z0-9_-]{24}$/);
      assert.equal(await findTableByQrToken(table.qrToken), null);
      assert.equal((await findTableByQrToken(qrToken))?.id, table.id);
    });

    test("20 regenerations give 20 different tokens; every table's token is unique", async () => {
      const table = await newTable();
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        await replaceQrToken(table.id);
        seen.add((await prisma.table.findUniqueOrThrow({ where: { id: table.id }, select: { qrToken: true } })).qrToken);
      }
      assert.equal(seen.size, 20);
      const [{ total, distinct }] = await prisma.$queryRaw<{ total: bigint; distinct: bigint }[]>`
        SELECT COUNT(*) AS total, COUNT(DISTINCT qrToken) AS \`distinct\` FROM \`Table\``;
      assert.equal(total, distinct);
    });

    test("a deleted table's token can't be regenerated and its link is dead", async () => {
      const table = await newTable();
      await prisma.table.update({ where: { id: table.id }, data: { deletedAt: new Date() } });
      assert.equal(await replaceQrToken(table.id), false);
      assert.equal(await findTableByQrToken(table.qrToken), null);
    });
  });

  describe("Send to kitchen", () => {
    for (const round of [1, 2, 3]) {
      test(`round ${round}: ${AT_ONCE} devices send the same lines at once → each line sent once`, async () => {
        const { orderId } = await newOrder();
        await tapDish(orderId, dishIds[0]);
        await tapDish(orderId, dishIds[1]);
        const version = await versionOf(orderId);

        const results = await Promise.all(Array.from({ length: AT_ONCE }, () => sendToKitchen(orderId, version, userId)));
        const sent = results.filter((r) => r.ok);
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].ok && sent[0].sent, [
          { station: "Kitchen", count: 1 },
          { station: "Bar", count: 1 },
        ]);
        for (const r of results.filter((x) => !x.ok)) assert.deepEqual(r, { ok: false, error: STALE, stale: true });

        const lines = await prisma.orderItem.findMany({ where: { orderId }, select: { kitchenStatus: true, sentAt: true } });
        assert.deepEqual(lines.map((l) => l.kitchenStatus), ["PENDING", "PENDING"]);
        assert.equal(new Set(lines.map((l) => l.sentAt?.getTime())).size, 1, "one send stamped them all");
        assert.equal(await versionOf(orderId), version + 1);
        // One ticket per station, made once.
        const kots = await prisma.kot.findMany({ where: { orderId }, select: { type: true, station: { select: { code: true } }, _count: { select: { lines: true } } } });
        assert.deepEqual(kots.map((k) => [k.type, k.station.code, k._count.lines]).sort(), [["NEW", "BAR", 1], ["NEW", "KIT", 1]]);
      });
    }

    test("a device that sends again with the new version sends nothing more", async () => {
      const { orderId } = await newOrder();
      await tapDish(orderId, dishIds[0]);
      const first = await sendToKitchen(orderId, await versionOf(orderId), userId);
      assert.ok(first.ok);
      const again = await sendToKitchen(orderId, first.version, userId);
      assert.deepEqual(again, { ok: true, version: first.version, sent: [] });
      assert.equal(await prisma.kot.count({ where: { orderId } }), 1);
    });
  });

  describe("Line changes", () => {
    test(`${AT_ONCE} taps from devices showing the same version → one applied, the rest refreshed`, async () => {
      const { orderId } = await newOrder();
      const version = await versionOf(orderId);
      const results = await Promise.all(
        Array.from({ length: AT_ONCE }, () => addLine({ orderId, version, productId: dishIds[0], modifierIds: [], note: null })),
      );
      assert.equal(results.filter((r) => r.ok).length, 1);
      for (const r of results.filter((x) => !x.ok)) assert.deepEqual(r, { ok: false, error: STALE, stale: true });
      const lines = await prisma.orderItem.findMany({ where: { orderId }, select: { quantity: true } });
      assert.deepEqual(lines, [{ quantity: 1 }]);
    });
  });

  describe("Move table", () => {
    for (const round of [1, 2, 3, 4, 5]) {
      test(`round ${round}: two orders move onto the same free table at once → one moves, the other is told it's taken`, async () => {
        const a = await newOrder();
        const b = await newOrder();
        const free = await newTable();
        const [ra, rb] = await Promise.all([
          moveOrder(a.orderId, await versionOf(a.orderId), free.id),
          moveOrder(b.orderId, await versionOf(b.orderId), free.id),
        ]);
        assert.equal([ra.ok, rb.ok].filter(Boolean).length, 1, JSON.stringify({ ra, rb }));
        assert.deepEqual(ra.ok ? rb : ra, { ok: false, error: TAKEN, stale: true });

        const [winner, loser] = ra.ok ? [a, b] : [b, a];
        const at = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { tableId: true } })).tableId;
        assert.equal(await at(winner.orderId), free.id);
        assert.equal(await at(loser.orderId), loser.table.id, "the other stays where it was");
        assert.equal(await prisma.order.count({ where: { tableId: free.id } }), 1);
      });
    }

    test(`${AT_ONCE} orders move onto one free table at once → exactly one there`, async () => {
      const orders = await Promise.all(Array.from({ length: AT_ONCE }, () => newOrder()));
      const free = await newTable();
      const results = await Promise.all(orders.map(async (o) => moveOrder(o.orderId, await versionOf(o.orderId), free.id)));
      assert.equal(results.filter((r) => r.ok).length, 1);
      for (const r of results.filter((x) => !x.ok)) assert.deepEqual(r, { ok: false, error: TAKEN, stale: true });
      assert.equal(await prisma.order.count({ where: { tableId: free.id } }), 1);
    });

    test("a move and Open table at once on the same free table → one order there", async () => {
      const a = await newOrder();
      const free = await newTable();
      const [move, open] = await Promise.all([moveOrder(a.orderId, await versionOf(a.orderId), free.id), openTableOrder(free.id, userId)]);
      assert.equal([move.ok, open.ok].filter(Boolean).length, 1, JSON.stringify({ move, open }));
      assert.equal(await prisma.order.count({ where: { tableId: free.id } }), 1);
    });

    test("two devices move the same order at once (same version) → it moves once", async () => {
      const a = await newOrder();
      const [x, y] = [await newTable(), await newTable()];
      const version = await versionOf(a.orderId);
      const results = await Promise.all([moveOrder(a.orderId, version, x.id), moveOrder(a.orderId, version, y.id)]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: STALE, stale: true });
      assert.equal(await versionOf(a.orderId), version + 1);
    });
  });

  describe("Merge", () => {
    for (const round of [1, 2, 3]) {
      test(`round ${round}: A into B and B into A at once → one merge, no deadlock, no line lost`, async () => {
        const a = await newOrder();
        const b = await newOrder();
        await tapDish(a.orderId, dishIds[0]);
        await tapDish(b.orderId, dishIds[1]);
        const [ab, ba] = await Promise.all([
          mergeOrders(a.orderId, await versionOf(a.orderId), b.orderId),
          mergeOrders(b.orderId, await versionOf(b.orderId), a.orderId),
        ]);
        assert.equal([ab.ok, ba.ok].filter(Boolean).length, 1, JSON.stringify({ ab, ba }));
        // The loser's order is the winner's target: still open, but the merge
        // changed it, so the loser's screen is out of date.
        assert.deepEqual(ab.ok ? ba : ab, { ok: false, error: STALE, stale: true });

        const [kept, gone] = ab.ok ? [b, a] : [a, b];
        assert.equal(await prisma.orderItem.count({ where: { orderId: kept.orderId } }), 2);
        assert.equal(await prisma.orderItem.count({ where: { orderId: gone.orderId } }), 0);
        const closed = await prisma.order.findUniqueOrThrow({ where: { id: gone.orderId }, select: { status: true, activeTableId: true } });
        assert.deepEqual(closed, { status: "CANCELLED", activeTableId: null });
      });
    }

    test("a merge and a tap on the source at once → the tap is refused or moves with the merge; nothing is lost", async () => {
      const a = await newOrder();
      const b = await newOrder();
      await tapDish(a.orderId, dishIds[0]);
      const version = await versionOf(a.orderId);
      const [merge, tap] = await Promise.all([
        mergeOrders(a.orderId, version, b.orderId),
        addLine({ orderId: a.orderId, version, productId: dishIds[1], modifierIds: [], note: null }),
      ]);
      assert.equal([merge.ok, tap.ok].filter(Boolean).length, 1, JSON.stringify({ merge, tap }));
      const onA = await prisma.orderItem.count({ where: { orderId: a.orderId } });
      const onB = await prisma.orderItem.count({ where: { orderId: b.orderId } });
      // Merge first: 1 line moved, the tap refused. Tap first: 2 lines on A,
      // the merge refused (stale version).
      assert.deepEqual([onA, onB], merge.ok ? [0, 1] : [2, 0]);
    });
  });

  test("no stock moved: every ProductStock row is as it was", async () => {
    assert.deepEqual(await stockSnapshot(), stockBefore);
  });
});
