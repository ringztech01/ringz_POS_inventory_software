// Restaurant Reports, Step 5, against a real database (a throwaway copy):
// bills settled the real way at tables in two areas, a takeaway, a refund,
// kitchen times — then By table (per table and per area, turn time, turns
// per day, the heat map's floor) and By order type (net, share, prep time).
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportTables.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { tableLines, typeLines } from "../lib/reportTables";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getOrderTypeReport, getTableReport } from "../server/queries/reports/tables";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// 2–3 July 2025 (two days) in Lagos.
const at = (iso: string) => new Date(iso);
const FROM = "2025-07-02";
const TO = "2025-07-03";
let userId = "";
let dish = "";
const area: Record<"hall" | "patio", string> = { hall: "", patio: "" };
const table: Record<"h1" | "h2" | "p1", string> = { h1: "", h2: "", p1: "" };
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function billed(tableId: string, plates: number, openedAt: Date, closedAt: Date) {
  const opened = await openTableOrder(tableId, userId);
  assert.ok(opened.ok);
  for (let i = 0; i < plates; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: i ? `plate ${i + 1}` : null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  const done = await settleOrder({ orderId: opened.orderId, version: await versionOf(opened.orderId), payments: [{ paymentType: "CASH", amount: "200" }], tip: "0", idempotencyKey: randomUUID() }, userId);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: opened.orderId }, data: { openedAt, closedAt } });
  return opened.orderId;
}

const mine = (f: Partial<ReportFilters> = {}): ReportFilters => ({ area: null, waiter: userId, type: null, station: null, device: null, ...f });
const window = () => parseReportFilters({ from: FROM, to: TO }, { dayStartMinutes: 0 }).window;

describe("Reports by table and order type (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  let takeaway = "";

  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Tobi", lastName: "Tables", email: `tobi-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    area.hall = (await prisma.diningArea.create({ data: { name: `RT Hall ${Date.now()}`, warehouseId, roomWidthM: 10, roomHeightM: 6 }, select: { id: true } })).id;
    area.patio = (await prisma.diningArea.create({ data: { name: `RT Patio ${Date.now()}`, warehouseId }, select: { id: true } })).id;
    const make = async (name: string, areaId: string, x: number) => (await prisma.table.create({ data: { name: testTable(name), seats: 4, areaId, qrToken: newQrToken(), x, y: 1, shape: "ROUND" }, select: { id: true } })).id;
    table.h1 = await make("H1", area.hall, 1);
    table.h2 = await make("H2", area.hall, 4);
    table.p1 = await make("P1", area.patio, 1);
    await prisma.floorFixture.create({ data: { areaId: area.hall, type: "BAR_COUNTER", label: "Bar", x: 7, y: 0, w: 3, h: 1 } });
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Table check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "RT Stew", code: `RT-${Date.now()}`, price: "20.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 100 } });

    // H1: two sittings (40 min, 60 min); H2: one (30 min); P1: one (20 min); a takeaway.
    const h1a = await billed(table.h1, 2, at("2025-07-02T11:00:00Z"), at("2025-07-02T11:40:00Z"));
    await billed(table.h1, 1, at("2025-07-03T18:00:00Z"), at("2025-07-03T19:00:00Z"));
    await billed(table.h2, 3, at("2025-07-02T12:00:00Z"), at("2025-07-02T12:30:00Z"));
    await billed(table.p1, 1, at("2025-07-03T13:00:00Z"), at("2025-07-03T13:20:00Z"));
    takeaway = await billed(table.p1, 2, at("2025-07-03T14:00:00Z"), at("2025-07-03T14:10:00Z"));
    await prisma.order.update({ where: { id: takeaway }, data: { type: "TAKEAWAY", tableId: null } });
    // Kitchen: H1's first bill 10 min each line, the takeaway 4 min.
    await prisma.orderItem.updateMany({ where: { orderId: h1a }, data: { sentAt: at("2025-07-02T11:05:00Z"), readyAt: at("2025-07-02T11:15:00Z") } });
    await prisma.orderItem.updateMany({ where: { orderId: takeaway }, data: { sentAt: at("2025-07-03T14:00:00Z"), readyAt: at("2025-07-03T14:04:00Z") } });
    // One plate of H1's first bill refunded on the 3rd.
    const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: h1a }, select: { saleId: true } })).saleId!;
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId }, select: { id: true } });
    assert.ok((await refundOrder({ orderId: h1a, lines: [{ saleItemId: line.id, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: false, idempotencyKey: randomUUID() }, userId)).ok);
    await prisma.saleReturn.updateMany({ where: { saleId }, data: { createdAt: at("2025-07-03T09:00:00Z") } });
  });
  after(() => prisma.$disconnect());

  test("each table and each area: orders, net (less refunds), average bill, turn time, turns per day", async () => {
    const result = await getTableReport(window(), mine());
    assert.ok(result.ok);
    const { lines, areas, totals } = tableLines({ ...result.data, days: window().days });
    const by = Object.fromEntries(lines.map((l) => [l.tableId, l]));
    assert.deepEqual([by[table.h1].orders, by[table.h1].net, by[table.h1].averageBill, by[table.h1].averageTurnSeconds, by[table.h1].turnsPerDay], [2, "40.00", "30.00", 3000, 1]);
    assert.deepEqual([by[table.h2].orders, by[table.h2].net, by[table.h2].averageTurnSeconds], [1, "60.00", 1800]);
    assert.deepEqual([by[table.p1].orders, by[table.p1].net], [1, "20.00"], "the takeaway isn't the table's");
    assert.deepEqual(areas.map((a) => [a.areaId, a.totals.orders, a.totals.net]).sort(), [[area.hall, 3, "100.00"], [area.patio, 1, "20.00"]].sort());
    assert.equal(totals.orders, 4);
  });

  test("the area filter; the heat map's floor (the room, tables where they stand, fixtures)", async () => {
    const result = await getTableReport(window(), mine({ area: area.patio }));
    assert.ok(result.ok);
    assert.deepEqual(result.data.orders.map((r) => r.tableId), [table.p1]);
    const hall = result.data.heat.find((a) => a.id === area.hall)!;
    assert.deepEqual(hall.room, { widthM: 10, heightM: 6 });
    assert.deepEqual(hall.tables.map((t) => [t.id, t.place.x, t.place.shape]).sort(), [[table.h1, 1, "ROUND"], [table.h2, 4, "ROUND"]].sort());
    assert.deepEqual(hall.fixtures.map((f) => [f.type, f.label, f.x]), [["BAR_COUNTER", "Bar", 7]]);
  });

  test("by order type: orders, net, share, prep time sent → Ready", async () => {
    const result = await getOrderTypeReport(window(), mine());
    assert.ok(result.ok);
    const { lines, totals } = typeLines(result.data);
    const by = Object.fromEntries(lines.map((l) => [l.type, l]));
    assert.deepEqual([by.DINE_IN.orders, by.DINE_IN.net, by.DINE_IN.prepSeconds, by.DINE_IN.prepLines], [4, "120.00", 600, 2]);
    assert.deepEqual([by.TAKEAWAY.orders, by.TAKEAWAY.net, by.TAKEAWAY.prepSeconds, by.TAKEAWAY.share], [1, "40.00", 240, 25]);
    assert.deepEqual([by.BAR_TAB.orders, by.DELIVERY.orders], [0, 0], "always shown");
    assert.deepEqual([totals.orders, totals.net, totals.share], [5, "160.00", 100]);
  });
});
