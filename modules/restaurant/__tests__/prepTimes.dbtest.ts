// The prep-time report (server/queries/prepTimes.ts) against a real
// database: a day of lines built by hand with known wait / cook / total
// times, checked against the averages worked out below. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/prepTimes.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { resolvePeriod } from "../lib/dashboard";
import { getPrepTime } from "../server/queries/dashboard";
import { getPrepSummary, getPrepTimeReport } from "../server/queries/prepTimes";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Wed 20 May 2026 (Lagos), a day nothing else in the copy cooked on.
const DAY = { from: "2026-05-20", to: "2026-05-20" };
const at = (time: string, day = "2026-05-20") => new Date(`${day}T${time}.000Z`);
let kit = "";
let bar = "";

describe("prep-time report (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    kit = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    bar = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "BAR" } })).id;
    await prisma.kitchenStation.update({ where: { id: bar }, data: { lateAfterMin: 3 } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Prep check" }, select: { id: true } })).id;
    const product = (name: string) =>
      prisma.product.create({ data: { name, code: `PT-${name}-${Date.now()}`, price: "10", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } }).then((p) => p.id);
    const jollof = await product("PT Jollof");
    const chapman = await product("PT Chapman");
    const rice = await product("PT Rice");

    const order = (deletedAt: Date | null = null) =>
      prisma.order.create({ data: { type: "TAKEAWAY", status: "SENT", warehouseId, deletedAt }, select: { id: true } }).then((o) => o.id);
    const live = await order();
    const gone = await order(new Date());
    type Line = { orderId?: string; productId: string; quantity: number; stationId: string | null; sent: Date | null; started: Date | null; ready: Date; cancelled?: boolean; deleted?: boolean };
    const line = (l: Line) =>
      prisma.orderItem.create({
        data: {
          orderId: l.orderId ?? live,
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: "10",
          stationId: l.stationId,
          kitchenStatus: "READY",
          sentAt: l.sent,
          startedAt: l.started,
          readyAt: l.ready,
          cancelledAt: l.cancelled ? l.ready : null,
          deletedAt: l.deleted ? l.ready : null,
        },
      });

    // Counted (UTC times; Lagos is +1):
    //   Kitchen Jollof ×2: wait 120, cook 600, total 720
    //   Kitchen Jollof ×1: wait 300, cook 1200, total 1500 — late (> 15 min)
    //   Bar Chapman ×3: skipped Preparing (no wait / cook), total 240 — late (> the Bar's 3 min)
    //   No station Rice ×1: wait 60, cook 940, total 1000 — late (> the default 15 min);
    //     ready 22:59:59 UTC = 23:59:59 in Lagos, still the 20th
    await line({ productId: jollof, quantity: 2, stationId: kit, sent: at("09:00:00"), started: at("09:02:00"), ready: at("09:12:00") });
    await line({ productId: jollof, quantity: 1, stationId: kit, sent: at("09:00:00"), started: at("09:05:00"), ready: at("09:25:00") });
    await line({ productId: chapman, quantity: 3, stationId: bar, sent: at("10:00:00"), started: null, ready: at("10:04:00") });
    await line({ productId: rice, quantity: 1, stationId: null, sent: at("22:43:19"), started: at("22:44:19"), ready: at("22:59:59") });
    // Not counted: cancelled, removed, on a deleted order, never sent, ready on the 21st (Lagos midnight).
    await line({ productId: jollof, quantity: 9, stationId: kit, sent: at("09:00:00"), started: at("09:01:00"), ready: at("11:00:00"), cancelled: true });
    await line({ productId: jollof, quantity: 9, stationId: kit, sent: at("09:00:00"), started: at("09:01:00"), ready: at("11:00:00"), deleted: true });
    await line({ orderId: gone, productId: jollof, quantity: 9, stationId: kit, sent: at("09:00:00"), started: at("09:01:00"), ready: at("11:00:00") });
    await line({ productId: jollof, quantity: 9, stationId: kit, sent: null, started: null, ready: at("11:00:00") });
    await line({ productId: rice, quantity: 9, stationId: null, sent: at("22:50:00"), started: null, ready: at("23:00:00") });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("summary: items cooked, average and slowest total, average wait and cook, late count", async () => {
    const summary = await getPrepSummary(DAY);
    assert.deepEqual(summary, {
      lines: 4,
      quantity: 7,
      avgWait: (120 + 300 + 60) / 3,
      avgCook: Number(((600 + 1200 + 940) / 3).toFixed(4)),
      avgTotal: (720 + 1500 + 240 + 1000) / 4,
      maxTotal: 1500,
      late: 3,
    });
  });

  test("by station (station order, no station last) and by dish (slowest first)", async () => {
    const report = await getPrepTimeReport(DAY);
    const pick = (g: { name: string; lines: number; quantity: number; avgWait: number | null; avgCook: number | null; avgTotal: number | null; maxTotal: number | null; late: number }) =>
      [g.name, g.lines, g.quantity, g.avgWait, g.avgCook, g.avgTotal, g.maxTotal, g.late];
    assert.deepEqual(report.byStation.map(pick), [
      ["Kitchen", 2, 3, 210, 900, 1110, 1500, 1],
      ["Bar", 1, 3, null, null, 240, 240, 1],
      ["No station", 1, 1, 60, 940, 1000, 1000, 1],
    ]);
    assert.deepEqual(report.byDish.map((g) => [g.name, g.avgTotal]), [["PT Jollof", 1110], ["PT Rice", 1000], ["PT Chapman", 240]]);
  });

  test("one station only; an empty range has zeros and no rows", async () => {
    const onlyKitchen = await getPrepTimeReport(DAY, kit);
    assert.deepEqual([onlyKitchen.summary.lines, onlyKitchen.byStation.map((s) => s.name), onlyKitchen.byDish.map((d) => d.name)], [2, ["Kitchen"], ["PT Jollof"]]);
    const empty = await getPrepTimeReport({ from: "2026-05-01", to: "2026-05-02" });
    assert.deepEqual(empty, { summary: { lines: 0, quantity: 0, avgWait: null, avgCook: null, avgTotal: null, maxTotal: null, late: 0 }, byStation: [], byDish: [] });
  });

  test("the dashboard's Avg prep time tile reads the same number", async () => {
    const tile = await getPrepTime(resolvePeriod("today", new Date("2026-05-20T12:00:00.000Z")));
    assert.equal(tile.current, (await getPrepSummary(DAY)).avgTotal);
    assert.equal(tile.current, 865);
  });
});
