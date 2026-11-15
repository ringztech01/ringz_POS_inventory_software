// Restaurant Reports, Step 1, against a real database (a throwaway copy):
// which orders the reports count — settled ones in the period on the business
// day, never training, open or deleted ones — and each filter (area, waiter,
// order type, station, the device whose till took payment). Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportsShell.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { openTill } from "../server/services/till";
import { periodOf, type ReportFilters } from "../server/queries/reports/filters";
import { countSettledOrders, getReportSetup } from "../server/queries/reports/shell";
import { getDayStartMinutes, setDayStartMinutes } from "../server/services/reportSettings";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Far from any real order on the copy: 10–11 March 2030.
// 01:30 Lagos on 11 March = 00:30 UTC.
const LATE_NIGHT = new Date("2030-03-11T00:30:00.000Z");
const EVENING = new Date("2030-03-10T19:00:00.000Z");

let userId = "";
const area: Record<"x" | "y", string> = { x: "", y: "" };
const dish: Record<"food" | "drink", string> = { food: "", drink: "" };
let stationId = "";
const till = randomUUID();
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function settled(areaId: string, productId: string, closedAt: Date, deviceId: string | null = null) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RS${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  const done = await settleOrder({ orderId: opened.orderId, version: await versionOf(opened.orderId), payments: [{ paymentType: "CASH", amount: "20" }], tip: "0", idempotencyKey: randomUUID() }, userId, { deviceId });
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: opened.orderId }, data: { closedAt } });
  return opened.orderId;
}

const none: ReportFilters = { area: null, waiter: null, type: null, station: null, device: null };
// Only this file's orders: its own waiter, on these far-off days.
const mine = (f: Partial<ReportFilters> = {}): ReportFilters => ({ ...none, waiter: userId, ...f });
const count = async (from: string, to: string, dayStart: number, f: ReportFilters) => {
  const result = await countSettledOrders(periodOf({ from, to }, dayStart), f);
  assert.ok(result.ok);
  return result.data;
};

describe("Reports shell (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    // This file's own waiter: other files on the same copy settle orders too.
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Shola", lastName: "Reports", email: `shola-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    // No receipt or drawer prints from this copy.
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    area.x = (await prisma.diningArea.create({ data: { name: "Reports X", warehouseId }, select: { id: true } })).id;
    area.y = (await prisma.diningArea.create({ data: { name: "Reports Y", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Reports check" }, select: { id: true } })).id;
    stationId = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    const make = async (name: string, station: string) => {
      const product = await prisma.product.create({ data: { name, code: `RS-${name}-${Date.now()}`, price: "20.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId: station }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.food = await make("RS Soup", stationId);
    // A line with no station goes to the kitchen; the drink is the bar's.
    const bar = await prisma.kitchenStation.findFirstOrThrow({ where: { code: { not: "KIT" }, deletedAt: null }, select: { id: true } });
    dish.drink = await make("RS Zobo", bar.id);
    await prisma.device.create({ data: { id: till, name: "Reports till" } });
    assert.ok((await openTill({ deviceId: till, float: new Decimal(0) }, userId)).ok);
  });
  after(() => prisma.$disconnect());

  test("settled orders on the business day; training, open and deleted ones never; each filter narrows", async () => {
    const late = await settled(area.x, dish.food, LATE_NIGHT);
    const paidAtTill = await settled(area.y, dish.drink, EVENING, till);
    const training = await settled(area.x, dish.food, EVENING);
    await prisma.order.update({ where: { id: training }, data: { training: true } });
    const deleted = await settled(area.x, dish.food, EVENING);
    await prisma.order.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
    // Open, never settled: not counted.
    const table = await prisma.table.create({ data: { name: testTable("RS-open"), seats: 2, areaId: area.x, qrToken: newQrToken() }, select: { id: true } });
    assert.ok((await openTableOrder(table.id, userId)).ok);
    await prisma.order.update({ where: { id: paidAtTill }, data: { type: "TAKEAWAY" } });

    // Midnight start: the 01:30 close is on the 11th.
    assert.equal(await count("2030-03-10", "2030-03-10", 0, mine()), 1, "the evening one only");
    assert.equal(await count("2030-03-11", "2030-03-11", 0, mine()), 1, "the 01:30 one");
    // 04:00 start: the 01:30 close counts on the 10th.
    assert.equal(await count("2030-03-10", "2030-03-10", 240, mine()), 2);
    assert.equal(await count("2030-03-11", "2030-03-11", 240, mine()), 0);

    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ area: area.x })), 1);
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ area: area.y })), 1);
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ type: "TAKEAWAY" })), 1);
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ type: "DINE_IN" })), 1);
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ station: stationId })), 1, "only the soup was made at the kitchen");
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ device: till })), 1, "only the one paid at that till");
    assert.equal(await count("2030-03-10", "2030-03-11", 0, mine({ device: till, area: area.x })), 0, "filters combine");
    assert.ok(late);
  });

  test("the day start: saved, then read by the reports", async () => {
    const before = await getDayStartMinutes();
    await setDayStartMinutes(240);
    assert.equal(await getDayStartMinutes(), 240);
    const setup = await getReportSetup();
    assert.ok(setup.ok && setup.data.dayStartMinutes === 240);
    await setDayStartMinutes(before);
  });

  test("the filter bar's choices include what was used", async () => {
    const setup = await getReportSetup();
    assert.ok(setup.ok);
    const { areas, waiters, devices, stations, dayStartMinutes } = setup.data;
    assert.ok(areas.some((a) => a.id === area.x && a.name === "Reports X"));
    assert.ok(waiters.some((w) => w.id === userId));
    assert.ok(devices.some((d) => d.id === till && d.name === "Reports till"));
    assert.ok(stations.some((s) => s.id === stationId));
    assert.equal(typeof dayStartMinutes, "number");
  });
});
