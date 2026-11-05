// Send to kitchen's KOTs, VOID KOTs and syncKotBump against a real database
// (services/orderFlow.ts + services/kots.ts). Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/kots.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, markLineServed, markLinesServed, sendToKitchen } from "../server/services/orderFlow";
import { openLinesAt } from "../server/services/stations";
import { NO_ACTIVE_STATION, registerPrint, syncKotBump } from "../server/services/kots";
import { advanceLine, bumpTicket, recallLine, recallTicket, UPDATED_ELSEWHERE } from "../server/services/kitchen";
import { getKitchenBoard, getKotForPrint } from "../server/queries/kds";
import { mergeOrders } from "../server/services/tableMoves";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let tableCount = 0;
const dish: Record<"jollof" | "chapman" | "plain" | "grill", string> = { jollof: "", chapman: "", plain: "", grill: "" };
const station: Record<"KIT" | "BAR" | "GRL", string> = { KIT: "", BAR: "", GRL: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function newOrder() {
  tableCount += 1;
  const table = await prisma.table.create({ data: { name: `Q${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  return opened.orderId;
}
async function tap(orderId: string, productId: string, note: string | null = null) {
  const result = await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note });
  assert.ok(result.ok, JSON.stringify(result));
}
const send = async (orderId: string) => sendToKitchen(orderId, await versionOf(orderId), userId);
const kotsOf = (orderId: string) =>
  prisma.kot.findMany({
    where: { orderId },
    orderBy: { number: "asc" },
    select: { id: true, type: true, note: true, bumpedAt: true, createdById: true, station: { select: { code: true } }, lines: { select: { name: true, quantity: true, note: true, orderItemId: true } } },
  });

describe("KOTs (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "KOT check", warehouseId }, select: { id: true } })).id;
    station.KIT = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    station.BAR = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "BAR" } })).id;
    // A third station, switched off: its dishes go to the first active one.
    station.GRL = (await prisma.kitchenStation.create({ data: { name: "Grill", code: "GRL", sortOrder: 5, isActive: false } })).id;

    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "KOT check" }, select: { id: true } })).id;
    const make = async (name: string, stationId: string | null) => {
      const product = await prisma.product.create({
        data: { name, code: `KC-${name}-${Date.now()}`, price: "10.00", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.jollof = await make("KC Jollof", station.KIT);
    dish.chapman = await make("KC Chapman", station.BAR);
    dish.plain = await make("KC Plain", null);
    dish.grill = await make("KC Suya", station.GRL);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("an order with dishes for 2 stations → 2 KOTs; no-station and inactive-station dishes go to the first active (Kitchen)", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    await tap(orderId, dish.jollof);
    await tap(orderId, dish.chapman, "less ice");
    await tap(orderId, dish.plain);
    await tap(orderId, dish.grill);
    const stockBefore = await prisma.productStock.findMany({ select: { id: true, quantity: true }, orderBy: { id: "asc" } });

    const result = await send(orderId);
    assert.ok(result.ok);
    assert.deepEqual(result.sent, [
      { station: "Kitchen", count: 3 },
      { station: "Bar", count: 1 },
    ]);
    const kots = await kotsOf(orderId);
    assert.deepEqual(
      kots.map((k) => [k.type, k.station.code, k.createdById === userId, k.bumpedAt, k.lines.map((l) => [l.name, l.quantity, l.note])]),
      [
        ["NEW", "KIT", true, null, [["KC Jollof", 2, null], ["KC Plain", 1, null], ["KC Suya", 1, null]]],
        ["NEW", "BAR", true, null, [["KC Chapman", 1, "less ice"]]],
      ],
    );
    const lines = await prisma.orderItem.findMany({ where: { orderId }, select: { kitchenStatus: true, stationId: true, sentAt: true } });
    assert.ok(lines.every((l) => l.kitchenStatus === "PENDING" && l.sentAt));
    assert.deepEqual(lines.map((l) => l.stationId).sort(), [station.BAR, station.KIT, station.KIT, station.KIT].sort());
    assert.deepEqual(await prisma.productStock.findMany({ select: { id: true, quantity: true }, orderBy: { id: "asc" } }), stockBefore, "no stock moved");

    // Lines added afterwards: their own new KOT, never the old one.
    await tap(orderId, dish.jollof);
    assert.ok((await send(orderId)).ok);
    const after = await kotsOf(orderId);
    assert.equal(after.length, 3);
    assert.deepEqual(after[2].lines.map((l) => [l.name, l.quantity]), [["KC Jollof", 1]]);
    assert.equal(after[0].lines.length, 3, "the first ticket is unchanged");
  });

  test("no active station: Send is refused and nothing changes", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    await prisma.kitchenStation.updateMany({ where: { id: { in: [station.KIT, station.BAR] } }, data: { isActive: false } });
    try {
      const version = await versionOf(orderId);
      assert.deepEqual(await sendToKitchen(orderId, version, userId), { ok: false, error: NO_ACTIVE_STATION });
      assert.equal(await versionOf(orderId), version);
      assert.equal(await prisma.kot.count({ where: { orderId } }), 0);
      assert.equal((await prisma.orderItem.findFirstOrThrow({ where: { orderId } })).kitchenStatus, "NEW");
    } finally {
      await prisma.kitchenStation.updateMany({ where: { id: { in: [station.KIT, station.BAR] } }, data: { isActive: true } });
    }
  });

  test("cancelling a sent line → a VOID KOT for its station, 'VOID: <reason>', in the same change", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    await tap(orderId, dish.chapman);
    assert.ok((await send(orderId)).ok);
    const chapman = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: dish.chapman } });
    const result = await cancelLine({ orderId, version: await versionOf(orderId), lineId: chapman.id, reason: "WRONG_ITEM", details: "brought Fanta" }, userId);
    assert.ok(result.ok);
    const kots = await kotsOf(orderId);
    const voids = kots.filter((k) => k.type === "VOID");
    assert.deepEqual(
      voids.map((k) => [k.station.code, k.note, k.lines.map((l) => [l.name, l.quantity, l.orderItemId])]),
      [["BAR", "VOID: Wrong item: brought Fanta", [["KC Chapman", 1, chapman.id]]]],
    );
    // The Bar's NEW ticket has nothing live left → done (hidden from the board).
    assert.ok(kots.find((k) => k.type === "NEW" && k.station.code === "BAR")?.bumpedAt);
    assert.equal(kots.find((k) => k.type === "NEW" && k.station.code === "KIT")?.bumpedAt, null);
  });

  test("a New line can't be cancelled (it's removed instead), so it never gets a VOID", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const result = await cancelLine({ orderId, version: await versionOf(orderId), lineId: line.id, reason: "CHANGED_MIND", details: null }, userId);
    assert.equal(result.ok, false);
    assert.equal(await prisma.kot.count({ where: { orderId } }), 0);
  });

  test("syncKotBump: bumped once every live line is Ready or Served, cleared when one goes back; Mark served keeps it", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    await tap(orderId, dish.plain);
    assert.ok((await send(orderId)).ok);
    const [kot] = await kotsOf(orderId);
    const [a, b] = kot.lines.map((l) => l.orderItemId);
    const bumpedAt = async () => (await prisma.kot.findUniqueOrThrow({ where: { id: kot.id }, select: { bumpedAt: true } })).bumpedAt;
    const set = async (id: string, kitchenStatus: "PREPARING" | "READY") => {
      await prisma.orderItem.update({ where: { id }, data: { kitchenStatus } });
      await prisma.$transaction((tx) => syncKotBump(tx, [id]));
    };

    await set(a, "READY");
    assert.equal(await bumpedAt(), null, "one of two ready");
    await set(b, "READY");
    const first = await bumpedAt();
    assert.ok(first, "both ready → bumped");
    await set(b, "READY");
    assert.deepEqual(await bumpedAt(), first, "unchanged when already bumped");
    await set(b, "PREPARING");
    assert.equal(await bumpedAt(), null, "one back to Preparing → cleared");
    await set(b, "READY");
    assert.ok(await bumpedAt());

    assert.ok((await markLineServed(orderId, await versionOf(orderId), a)).ok);
    assert.ok(await bumpedAt(), "Ready + Served is still done");
  });

  describe("the kitchen display", () => {
    const line = (id: string) => prisma.orderItem.findUniqueOrThrow({ where: { id }, select: { kitchenStatus: true, startedAt: true, readyAt: true } });
    const ticketOf = (orderId: string, code: string) =>
      prisma.kot.findFirstOrThrow({ where: { orderId, type: "NEW", station: { code } }, select: { id: true, bumpedAt: true, lines: { select: { orderItemId: true } } } });
    async function sentOrder() {
      const orderId = await newOrder();
      await tap(orderId, dish.jollof);
      await tap(orderId, dish.plain);
      await tap(orderId, dish.chapman);
      assert.ok((await send(orderId)).ok);
      return orderId;
    }

    test("tap forward: Sent → Preparing (startedAt) → Ready (readyAt); back: clears them; Ready can't go forward", async () => {
      const orderId = await sentOrder();
      const [itemId] = (await ticketOf(orderId, "BAR")).lines.map((l) => l.orderItemId);
      assert.deepEqual(await advanceLine(itemId, "PENDING"), { ok: true });
      const preparing = await line(itemId);
      assert.equal(preparing.kitchenStatus, "PREPARING");
      assert.ok(preparing.startedAt && !preparing.readyAt);
      assert.deepEqual(await advanceLine(itemId, "PREPARING"), { ok: true });
      const ready = await line(itemId);
      assert.equal(ready.kitchenStatus, "READY");
      assert.ok(ready.readyAt && ready.startedAt && ready.readyAt >= ready.startedAt);
      assert.ok((await ticketOf(orderId, "BAR")).bumpedAt, "its only line Ready → the Bar ticket is bumped");
      assert.equal((await advanceLine(itemId, "READY")).ok, false, "Served is set by waiters, not the kitchen");

      assert.deepEqual(await recallLine(itemId, "READY"), { ok: true });
      assert.deepEqual(await line(itemId), { kitchenStatus: "PREPARING", startedAt: preparing.startedAt, readyAt: null });
      assert.equal((await ticketOf(orderId, "BAR")).bumpedAt, null, "back on the board");
      assert.deepEqual(await recallLine(itemId, "PREPARING"), { ok: true });
      assert.deepEqual(await line(itemId), { kitchenStatus: "PENDING", startedAt: null, readyAt: null });
    });

    test("two screens tap the same line at once: one wins, the other is told and nothing moves twice", async () => {
      for (const round of [1, 2, 3]) {
        const orderId = await sentOrder();
        const [itemId] = (await ticketOf(orderId, "BAR")).lines.map((l) => l.orderItemId);
        const results = await Promise.all([advanceLine(itemId, "PENDING"), advanceLine(itemId, "PENDING")]);
        assert.equal(results.filter((r) => r.ok).length, 1, `round ${round}`);
        assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: UPDATED_ELSEWHERE, stale: true });
        assert.equal((await line(itemId)).kitchenStatus, "PREPARING", "one step, not two");
      }
    });

    test("a screen that's out of date (the line moved, or was cancelled) is told", async () => {
      const orderId = await sentOrder();
      const [jollof] = (await ticketOf(orderId, "KIT")).lines.map((l) => l.orderItemId);
      assert.ok((await advanceLine(jollof, "PENDING")).ok);
      assert.deepEqual(await advanceLine(jollof, "PENDING"), { ok: false, error: UPDATED_ELSEWHERE, stale: true });
      const result = await cancelLine({ orderId, version: await versionOf(orderId), lineId: jollof, reason: "KITCHEN_ISSUE", details: null }, userId);
      assert.ok(result.ok);
      assert.deepEqual(await advanceLine(jollof, "PREPARING"), { ok: false, error: UPDATED_ELSEWHERE, stale: true });
    });

    test("All ready bumps the ticket (Sent lines get a start time too); a second bump is told; Recall brings it back", async () => {
      const orderId = await sentOrder();
      const kit = await ticketOf(orderId, "KIT");
      const [a, b] = kit.lines.map((l) => l.orderItemId);
      assert.ok((await advanceLine(a, "PENDING")).ok);
      const results = await Promise.all([bumpTicket(kit.id), bumpTicket(kit.id)]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: UPDATED_ELSEWHERE, stale: true });
      for (const id of [a, b]) {
        const l = await line(id);
        assert.equal(l.kitchenStatus, "READY");
        assert.ok(l.startedAt && l.readyAt);
      }
      assert.ok((await ticketOf(orderId, "KIT")).bumpedAt);
      assert.equal((await ticketOf(orderId, "BAR")).bumpedAt, null, "the Bar's ticket is its own");

      // Serve one, then recall: the served one stays served.
      assert.ok((await markLineServed(orderId, await versionOf(orderId), a)).ok);
      assert.deepEqual(await recallTicket(kit.id), { ok: true });
      assert.deepEqual([(await line(a)).kitchenStatus, (await line(b)).kitchenStatus], ["SERVED", "PREPARING"]);
      assert.equal((await line(b)).readyAt, null);
      assert.equal((await ticketOf(orderId, "KIT")).bumpedAt, null);
      assert.deepEqual(await recallTicket(kit.id), { ok: false, error: UPDATED_ELSEWHERE, stale: true }, "not bumped any more");

      // Everything served: nothing to recall.
      assert.ok((await bumpTicket(kit.id)).ok);
      assert.ok((await markLineServed(orderId, await versionOf(orderId), b)).ok);
      assert.equal((await recallTicket(kit.id)).ok, false);
    });

    test("the board: each station's tab shows its own tickets; done tickets move to Recently done", async () => {
      const orderId = await sentOrder();
      const kit = await ticketOf(orderId, "KIT");
      const bar = await ticketOf(orderId, "BAR");
      const ids = (board: Awaited<ReturnType<typeof getKitchenBoard>>) => board.tickets.map((t) => t.id);
      const kitchenTab = await getKitchenBoard({ station: "KIT", view: "active" });
      const barTab = await getKitchenBoard({ station: "BAR", view: "active" });
      const all = await getKitchenBoard({ station: null, view: "active" });
      assert.ok(ids(kitchenTab).includes(kit.id) && !ids(kitchenTab).includes(bar.id));
      assert.ok(ids(barTab).includes(bar.id) && !ids(barTab).includes(kit.id));
      assert.ok(ids(all).includes(kit.id) && ids(all).includes(bar.id));
      const ticket = kitchenTab.tickets.find((t) => t.id === kit.id)!;
      assert.deepEqual(
        [ticket.station.code, ticket.type, ticket.lines.map((l) => [l.name, l.quantity, l.status]), ticket.cancelledCount, /^KOT-\d{6}$/.test(ticket.ref), /^ORD-\d{4,}$/.test(ticket.orderRef)],
        ["KIT", "Dine-in", [["KC Jollof", 1, "PENDING"], ["KC Plain", 1, "PENDING"]], 0, true, true],
      );

      assert.ok((await bumpTicket(kit.id)).ok);
      assert.ok(!ids(await getKitchenBoard({ station: "KIT", view: "active" })).includes(kit.id));
      const done = await getKitchenBoard({ station: "KIT", view: "done" });
      assert.equal(done.tickets[0].id, kit.id, "newest done first");
      assert.ok(!done.active.some((t) => t.id === kit.id));

      // A ticket whose lines are all cancelled disappears.
      const [chapman] = bar.lines.map((l) => l.orderItemId);
      assert.ok((await cancelLine({ orderId, version: await versionOf(orderId), lineId: chapman, reason: "OTHER", details: "spilt" }, userId)).ok);
      assert.ok(!ids(await getKitchenBoard({ station: null, view: "active" })).includes(bar.id));
      assert.ok(!ids(await getKitchenBoard({ station: null, view: "done" })).includes(bar.id));
    });
  });

  describe("printing", () => {
    test("Print KOT counts each print; a missing ticket is refused", async () => {
      const orderId = await newOrder();
      await tap(orderId, dish.jollof);
      assert.ok((await send(orderId)).ok);
      const { id } = await prisma.kot.findFirstOrThrow({ where: { orderId }, select: { id: true } });
      assert.deepEqual(await registerPrint(id), { ok: true, printCount: 1 });
      assert.deepEqual(await registerPrint(id), { ok: true, printCount: 2 });
      const kot = await prisma.kot.findUniqueOrThrow({ where: { id }, select: { printCount: true, lastPrintedAt: true } });
      assert.equal(kot.printCount, 2);
      assert.ok(kot.lastPrintedAt);
      assert.deepEqual(await registerPrint("missing-ticket"), { ok: false, error: "That ticket no longer exists." });
    });

    test("the printed ticket: station, table and area, refs, guests, lines with modifiers and notes, item count; VOID with its note", async () => {
      const orderId = await newOrder();
      await tap(orderId, dish.jollof, "no pepper");
      await tap(orderId, dish.chapman);
      await prisma.order.update({ where: { id: orderId }, data: { guests: 3 } });
      await prisma.orderItem.updateMany({
        where: { orderId, productId: dish.jollof },
        data: { quantity: 2, modifiers: [{ id: "m1", group: "Portion", name: "Large", price: "2.00" }, { id: "m2", group: "Extras", name: "Plantain", price: "1.00" }] },
      });
      assert.ok((await send(orderId)).ok);
      const kit = await prisma.kot.findFirstOrThrow({ where: { orderId, station: { code: "KIT" } }, select: { id: true } });
      const printed = await getKotForPrint(kit.id);
      assert.ok(printed);
      const { number } = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true } });
      assert.deepEqual(
        [printed.type, printed.station, printed.table, printed.area, printed.orderRef, printed.orderType, printed.guests, printed.note, printed.lines, printed.items, printed.printCount],
        ["NEW", "Kitchen", `Q${tableCount}`, "KOT check", `ORD-${String(number).padStart(4, "0")}`, "Dine-in", 3, null, [{ quantity: 2, name: "KC Jollof", modifiers: "Large · Plantain", note: "no pepper" }], 2, 0],
      );

      const chapman = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: dish.chapman }, select: { id: true } });
      assert.ok((await cancelLine({ orderId, version: await versionOf(orderId), lineId: chapman.id, reason: "CHANGED_MIND", details: null }, userId)).ok);
      const voidKot = await prisma.kot.findFirstOrThrow({ where: { orderId, type: "VOID" }, select: { id: true } });
      const voided = await getKotForPrint(voidKot.id);
      assert.deepEqual([voided?.type, voided?.station, voided?.note, voided?.lines.map((l) => l.name), voided?.items], ["VOID", "Bar", "VOID: Customer changed mind", ["KC Chapman"], 1]);
      assert.equal(await getKotForPrint("missing-ticket"), null);
    });

    test("after a merge, the ticket prints the table the food now goes to", async () => {
      const source = await newOrder();
      const target = await newOrder();
      const targetTable = `Q${tableCount}`;
      await tap(source, dish.jollof);
      assert.ok((await send(source)).ok);
      await tap(target, dish.chapman);
      const merged = await mergeOrders(source, await versionOf(source), target);
      assert.ok(merged.ok, JSON.stringify(merged));
      const kot = await prisma.kot.findFirstOrThrow({ where: { orderId: source }, select: { id: true } });
      assert.equal((await getKotForPrint(kot.id))?.table, targetTable);
    });
  });

  describe("the waiter side", () => {
    async function readyOrder() {
      const orderId = await newOrder();
      await tap(orderId, dish.jollof);
      await tap(orderId, dish.chapman);
      assert.ok((await send(orderId)).ok);
      const lines = await prisma.orderItem.findMany({ where: { orderId }, select: { id: true }, orderBy: { createdAt: "asc" } });
      return { orderId, ids: lines.map((l) => l.id) };
    }

    test("Mark served (Ready bar): every Ready line served at once, with servedAt; all served → the order is Served", async () => {
      const { orderId, ids } = await readyOrder();
      for (const id of ids) {
        assert.ok((await advanceLine(id, "PENDING")).ok);
        assert.ok((await advanceLine(id, "PREPARING")).ok);
      }
      const version = await versionOf(orderId);
      const result = await markLinesServed(orderId, version, ids);
      assert.deepEqual(result, { ok: true, version: version + 1 });
      const lines = await prisma.orderItem.findMany({ where: { id: { in: ids } }, select: { kitchenStatus: true, servedAt: true } });
      assert.ok(lines.every((l) => l.kitchenStatus === "SERVED" && l.servedAt));
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status, "SERVED");
      const kots = await prisma.kot.findMany({ where: { orderId, type: "NEW" }, select: { bumpedAt: true } });
      assert.ok(kots.every((k) => k.bumpedAt), "served tickets stay done");
    });

    test("Mark served when the kitchen has just stepped one back: refused, nothing served; the per-line Served sets servedAt too", async () => {
      const { orderId, ids } = await readyOrder();
      for (const id of ids) {
        assert.ok((await advanceLine(id, "PENDING")).ok);
        assert.ok((await advanceLine(id, "PREPARING")).ok);
      }
      assert.ok((await recallLine(ids[1], "READY")).ok, "the kitchen takes the Chapman back");
      const version = await versionOf(orderId);
      const result = await markLinesServed(orderId, version, ids);
      assert.deepEqual(result, { ok: false, error: "Some of those lines changed in the kitchen — refreshed.", stale: true });
      const statuses = await prisma.orderItem.findMany({ where: { id: { in: ids } }, select: { kitchenStatus: true, servedAt: true }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(statuses, [{ kitchenStatus: "READY", servedAt: null }, { kitchenStatus: "PREPARING", servedAt: null }]);
      assert.equal(await versionOf(orderId), version);

      assert.ok((await markLineServed(orderId, version, ids[0])).ok);
      assert.ok((await prisma.orderItem.findUniqueOrThrow({ where: { id: ids[0] }, select: { servedAt: true } })).servedAt);
    });

    test("serving and the kitchen stepping back at the same moment: one of them wins, never both", async () => {
      for (const round of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const { orderId, ids } = await readyOrder();
        for (const id of ids) {
          assert.ok((await advanceLine(id, "PENDING")).ok);
          assert.ok((await advanceLine(id, "PREPARING")).ok);
        }
        const [serve, back] = await Promise.all([markLinesServed(orderId, await versionOf(orderId), ids), recallLine(ids[0], "READY")]);
        assert.equal([serve.ok, back.ok].filter(Boolean).length, 1, `round ${round}: ${JSON.stringify({ serve, back })}`);
        const first = (await prisma.orderItem.findUniqueOrThrow({ where: { id: ids[0] }, select: { kitchenStatus: true } })).kitchenStatus;
        assert.equal(first, serve.ok ? "SERVED" : "PREPARING");
      }
    });

    test("a storm of kitchen and floor changes on one order at once: every call answers (no errors thrown), and tickets match their lines", async () => {
      for (const round of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const orderId = await newOrder();
        await tap(orderId, dish.jollof);
        await tap(orderId, dish.plain);
        await tap(orderId, dish.chapman);
        assert.ok((await send(orderId)).ok);
        const lines = await prisma.orderItem.findMany({ where: { orderId }, select: { id: true }, orderBy: { createdAt: "asc" } });
        const [a, b, c] = lines.map((l) => l.id);
        const kit = await prisma.kot.findFirstOrThrow({ where: { orderId, station: { code: "KIT" } }, select: { id: true } });
        assert.ok((await advanceLine(c, "PENDING")).ok);
        assert.ok((await advanceLine(c, "PREPARING")).ok);
        const version = await versionOf(orderId);
        const results = await Promise.all([
          advanceLine(a, "PENDING"),
          advanceLine(a, "PENDING"),
          recallLine(c, "READY"),
          bumpTicket(kit.id),
          markLinesServed(orderId, version, [c]),
          cancelLine({ orderId, version, lineId: b, reason: "KITCHEN_ISSUE", details: null }, userId),
          advanceLine(b, "PENDING"),
        ]);
        for (const r of results) assert.equal(typeof r.ok, "boolean", `round ${round}: ${JSON.stringify(r)}`);
        for (const r of results) if (!r.ok) assert.ok(r.error && !r.error.startsWith("Something went wrong"), `round ${round}: ${r.error}`);
        // Every NEW ticket's bump matches its live lines.
        const kots = await prisma.kot.findMany({
          where: { orderId, type: "NEW" },
          select: { bumpedAt: true, lines: { select: { orderItem: { select: { kitchenStatus: true, cancelledAt: true, deletedAt: true } } } } },
        });
        for (const kot of kots) {
          const done = kot.lines.every((l) => l.orderItem.cancelledAt || l.orderItem.deletedAt || ["READY", "SERVED"].includes(l.orderItem.kitchenStatus));
          assert.equal(!!kot.bumpedAt, done, `round ${round}: ticket bump matches its lines`);
        }
      }
    });

    test("a station's open lines: Sent, Preparing or Ready count; Served and cancelled don't", async () => {
      const { orderId, ids } = await readyOrder();
      const bar = station.BAR;
      const before = await openLinesAt(prisma, bar);
      assert.ok(before >= 1);
      assert.ok((await advanceLine(ids[1], "PENDING")).ok);
      assert.ok((await advanceLine(ids[1], "PREPARING")).ok);
      assert.equal(await openLinesAt(prisma, bar), before, "Ready still counts");
      assert.ok((await markLineServed(orderId, await versionOf(orderId), ids[1])).ok);
      assert.equal(await openLinesAt(prisma, bar), before - 1, "served → not open");
    });
  });
});
