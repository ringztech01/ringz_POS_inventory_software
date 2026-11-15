// Restaurant Reports, Step 3, against a real database (a throwaway copy):
// bills settled the real way — options, a 10% bill discount, a refund — then
// By dish: each dish's gross, its share of the discount, its refunds, its
// cost at settle and its options; the dishes add up to the bills; the
// station filter; and the 86 log (the switch writes it, By dish adds up the
// minutes). Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportDishes.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { applyOrderDiscount } from "../server/services/bill";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { setMenuItemFlag } from "../server/services/menuItems";
import { dishLines } from "../lib/reportDishes";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getDishReport } from "../server/queries/reports/dishes";
import { getOverview } from "../server/queries/reports/overview";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// 10 May 2025 in Lagos: [09 May 23:00Z, 10 May 23:00Z). In the past, so the 86 minutes (counted up to now) are whole.
const at = (iso: string) => new Date(iso);
const DAY = "2025-05-10";

let userId = "";
let areaId = "";
let kitchen = "";
const dish: Record<"jollof" | "zobo", string> = { jollof: "", zobo: "" };
let chickenOption = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function billed(lines: { productId: string; modifierIds?: string[] }[], closedAt: Date, discount?: string) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RD${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  for (const line of lines) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: line.productId, modifierIds: line.modifierIds ?? [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  if (discount) assert.ok((await applyOrderDiscount({ orderId: opened.orderId, version: await versionOf(opened.orderId), type: "PERCENT", value: discount, reason: "Regular guest" }, userId)).ok);
  const done = await settleOrder({ orderId: opened.orderId, version: await versionOf(opened.orderId), payments: [{ paymentType: "CASH", amount: "200" }], tip: "0", idempotencyKey: randomUUID() }, userId);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: opened.orderId }, data: { closedAt } });
  return opened.orderId;
}

const mine = (f: Partial<ReportFilters> = {}): ReportFilters => ({ area: null, waiter: userId, type: null, station: null, device: null, ...f });
const window = () => parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window;
async function report(f: Partial<ReportFilters> = {}, withCost = true) {
  const result = await getDishReport(window(), mine(f), { withCost });
  assert.ok(result.ok);
  return { data: result.data, ...dishLines(result.data) };
}

describe("Reports by dish (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  let main = "";

  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Dayo", lastName: "Reports", email: `dayo-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0, restaurantDiscountLimitPercent: 50 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Dish check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Dish check" }, select: { id: true } })).id;
    kitchen = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    const bar = (await prisma.kitchenStation.findFirstOrThrow({ where: { code: { not: "KIT" }, deletedAt: null }, select: { id: true } })).id;
    const mains = (await prisma.menuGroup.create({ data: { name: "RD Mains", department: "FOOD" } })).id;
    const drinks = (await prisma.menuGroup.create({ data: { name: "RD Drinks", department: "BAR" } })).id;
    const extras = await prisma.modifierGroup.create({ data: { name: "RD Extras", minSelect: 0, maxSelect: 2, modifiers: { create: [{ name: "Extra chicken", price: "5" }] } }, select: { id: true, modifiers: { select: { id: true } } } });
    chickenOption = extras.modifiers[0].id;
    const make = async (name: string, price: string, cost: string, stationId: string, menuGroupId: string) => {
      const p = await prisma.product.create({ data: { name, code: `RD-${name}-${Date.now()}`, price, cost, orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId, menuGroupId }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 100 } });
      return p.id;
    };
    dish.jollof = await make("RD Jollof", "20.00", "8.00", kitchen, mains);
    await prisma.product.update({ where: { id: dish.jollof }, data: { modifierGroups: { connect: { id: extras.id } } } });
    dish.zobo = await make("RD Zobo", "10.00", "3.00", bar, drinks);

    // ₦110 of items: 2 Jollof with Extra chicken (₦25), 2 plain (₦20), 2 Zobo; 10% off → ₦99.
    main = await billed(
      [{ productId: dish.jollof, modifierIds: [chickenOption] }, { productId: dish.jollof, modifierIds: [chickenOption] }, { productId: dish.jollof }, { productId: dish.jollof }, { productId: dish.zobo }, { productId: dish.zobo }],
      at("2025-05-10T18:30:00Z"),
      "10",
    );
    await billed([{ productId: dish.zobo }], at("2025-05-10T12:00:00Z"));
    // One Zobo refunded that evening.
    const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: main }, select: { saleId: true } })).saleId!;
    const zoboLine = await prisma.saleItem.findFirstOrThrow({ where: { saleId, productId: dish.zobo }, select: { id: true } });
    const refunded = await refundOrder({ orderId: main, lines: [{ saleItemId: zoboLine.id, quantity: 1 }], paymentType: "CASH", reason: "Warm", returnToStock: false, idempotencyKey: randomUUID() }, userId);
    assert.ok(refunded.ok, JSON.stringify(refunded));
    await prisma.saleReturn.updateMany({ where: { saleId }, data: { createdAt: at("2025-05-10T20:00:00Z") } });
  });
  after(() => prisma.$disconnect());

  test("each dish: gross, its share of the bill's discount, refunds, net; they add up to the bills", async () => {
    const { lines, totals } = await report();
    const by = Object.fromEntries(lines.map((l) => [l.productId, l]));
    assert.deepEqual([by[dish.jollof].quantity, by[dish.jollof].gross, by[dish.jollof].discount, by[dish.jollof].net], [4, "90.00", "9.00", "81.00"]);
    const refund = await prisma.saleReturn.findFirstOrThrow({ where: { sale: { order: { id: main } } }, select: { grandTotal: true } });
    assert.deepEqual([by[dish.zobo].quantity, by[dish.zobo].gross, by[dish.zobo].discount, by[dish.zobo].refunds], [3, "30.00", "2.00", refund.grandTotal.toFixed(2)]);
    // No service charge here, so the dishes add up to the Overview's net sales.
    const overview = await getOverview(window(), mine(), { dayStartMinutes: 0, withCost: false });
    assert.ok(overview.ok);
    assert.equal(totals.net, overview.data.current.net.toFixed(2));
    assert.equal(totals.gross, "120.00");
  });

  test("food cost at settle, margin; without View Cost none of it", async () => {
    const { lines } = await report();
    const by = Object.fromEntries(lines.map((l) => [l.productId, l]));
    assert.deepEqual([by[dish.jollof].cost, by[dish.jollof].margin, by[dish.jollof].marginPct], ["32.00", "49.00", 60.5]);
    assert.equal(by[dish.zobo].cost, "9.00");
    const { data, lines: plain } = await report({}, false);
    assert.equal(data.costs, null);
    assert.ok(plain.every((l) => l.cost === null && l.margin === null));
  });

  test("the options: times chosen and what their price changes brought in", async () => {
    const jollof = (await report()).lines.find((l) => l.productId === dish.jollof)!;
    assert.deepEqual(jollof.modifiers, [{ group: "RD Extras", name: "Extra chicken", times: 2, revenue: "10.00" }]);
  });

  test("the station filter: only the dishes made there", async () => {
    assert.deepEqual((await report({ station: kitchen })).lines.map((l) => l.productId), [dish.jollof]);
  });

  test("the 86 switch writes the log (only on a change); By dish adds up the minutes", async () => {
    assert.ok((await setMenuItemFlag(dish.jollof, "isAvailable", false, userId)).ok);
    assert.ok((await setMenuItemFlag(dish.jollof, "isAvailable", false, userId)).ok, "already off: fine");
    assert.ok((await setMenuItemFlag(dish.jollof, "isAvailable", true, userId)).ok);
    assert.ok((await setMenuItemFlag(dish.jollof, "showOnMenu", false, userId)).ok, "not logged");
    const log = await prisma.menuAvailabilityLog.findMany({ where: { productId: dish.jollof }, orderBy: { createdAt: "asc" }, select: { id: true, available: true, userId: true } });
    assert.deepEqual(log.map((l) => [l.available, l.userId]), [[false, userId], [true, userId]]);
    // As if: off 18:00–19:30Z that day, then off again at 22:30Z, still off at the day's end (23:00Z).
    await prisma.menuAvailabilityLog.update({ where: { id: log[0].id }, data: { createdAt: at("2025-05-10T18:00:00Z") } });
    await prisma.menuAvailabilityLog.update({ where: { id: log[1].id }, data: { createdAt: at("2025-05-10T19:30:00Z") } });
    await prisma.menuAvailabilityLog.create({ data: { productId: dish.jollof, available: false, createdAt: at("2025-05-10T22:30:00Z") } });
    const by = Object.fromEntries((await report()).lines.map((l) => [l.productId, l.minutes86]));
    assert.deepEqual([by[dish.jollof], by[dish.zobo]], [120, 0]);
  });
});
