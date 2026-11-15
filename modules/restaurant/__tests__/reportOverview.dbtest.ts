// Restaurant Reports, Step 2, against a real database (a throwaway copy):
// bills settled the real way, then the Overview. Net sales are the Sales'
// own totals (what the retail Sales report shows) less refunds made in the
// period; tips never in it; training orders never; each line's cost
// recorded at settle (and the migration's backfill gives the same); lines
// with no cost counted; waste ACTIVE only; Food vs Bar by the item's group.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportOverview.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { netByDepartment, netByHour } from "../lib/reportOverview";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { countSettledOrders } from "../server/queries/reports/shell";
import { getOverview } from "../server/queries/reports/overview";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Far from any real order on the copy: 9–10 March 2030 (Lagos = UTC+1).
const at = (iso: string) => new Date(iso);

let userId = "";
let areaId = "";
let warehouseId = "";
const item: Record<"food" | "drink" | "nocost" | "rice", string> = { food: "", drink: "", nocost: "", rice: "" };
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function settled(lines: string[], { closedAt, guests = 1, tip = "0", pay = "100" }: { closedAt: Date; guests?: number; tip?: string; pay?: string }) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RO${n}`), seats: 6, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  for (const productId of lines) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  const done = await settleOrder({ orderId: opened.orderId, version: await versionOf(opened.orderId), payments: [{ paymentType: "CASH", amount: pay }], tip, idempotencyKey: randomUUID() }, userId);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: opened.orderId }, data: { closedAt, guests } });
  return opened.orderId;
}

const mine = (): ReportFilters => ({ area: null, waiter: userId, type: null, station: null, device: null });
const windowFor = (from: string, to: string) => parseReportFilters({ from, to }, { dayStartMinutes: 0, now: at("2030-03-10T12:00:00Z") }).window;

describe("Reports overview (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  const order: Record<"main" | "small" | "training" | "dayBefore", string> = { main: "", small: "", training: "", dayBefore: "" };

  before(async () => {
    // This file's own waiter: other files on the same copy settle orders too.
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Ovie", lastName: "Reports", email: `ovie-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Overview check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Overview check" }, select: { id: true } })).id;
    const foodGroup = (await prisma.menuGroup.create({ data: { name: "RO Mains", department: "FOOD" }, select: { id: true } })).id;
    const barGroup = (await prisma.menuGroup.create({ data: { name: "RO Drinks", department: "BAR" }, select: { id: true } })).id;
    const make = async (name: string, data: { price: string; cost: string | null; productType: "MENU_ITEM" | "INGREDIENT"; menuGroupId?: string }) => {
      const p = await prisma.product.create({ data: { name, code: `RO-${name}-${Date.now()}`, price: data.price, cost: data.cost, orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: data.productType, menuGroupId: data.menuGroupId ?? null }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 200 } });
      return p.id;
    };
    item.rice = await make("RO Rice", { price: "1", cost: "2.50", productType: "INGREDIENT" });
    const chicken = await make("RO Chicken", { price: "1", cost: "4.00", productType: "INGREDIENT" });
    const salt = await make("RO Salt", { price: "1", cost: null, productType: "INGREDIENT" });
    // ₦20, recipe 2 rice + 1 chicken = ₦9.00 a plate.
    item.food = await make("RO Jollof", { price: "20.00", cost: "999", productType: "MENU_ITEM", menuGroupId: foodGroup });
    await prisma.recipeLine.createMany({ data: [{ menuItemId: item.food, ingredientId: item.rice, quantity: 2 }, { menuItemId: item.food, ingredientId: chicken, quantity: 1 }] });
    // ₦10, no recipe, its own cost ₦3.00, on the bar's buttons.
    item.drink = await make("RO Zobo", { price: "10.00", cost: "3.00", productType: "MENU_ITEM", menuGroupId: barGroup });
    // ₦15, a recipe with salt (no cost), on no buttons.
    item.nocost = await make("RO Pepper soup", { price: "15.00", cost: "5", productType: "MENU_ITEM" });
    await prisma.recipeLine.createMany({ data: [{ menuItemId: item.nocost, ingredientId: chicken, quantity: 1 }, { menuItemId: item.nocost, ingredientId: salt, quantity: 1 }] });

    // 10 March: ₦50 at 20:00 (3 guests, ₦5 tip), ₦15 at 13:30; a training ₦20; 9 March: ₦10.
    order.main = await settled([item.food, item.food, item.drink], { closedAt: at("2030-03-10T19:00:00Z"), guests: 3, tip: "5", pay: "55" });
    order.small = await settled([item.nocost], { closedAt: at("2030-03-10T12:30:00Z") });
    order.training = await settled([item.food], { closedAt: at("2030-03-10T15:00:00Z") });
    await prisma.order.update({ where: { id: order.training }, data: { training: true } });
    order.dayBefore = await settled([item.drink], { closedAt: at("2030-03-09T18:00:00Z") });

    // The Zobo refunded at 22:00 on the 10th (a bill from that day).
    const sale = await prisma.order.findUniqueOrThrow({ where: { id: order.main }, select: { saleId: true } });
    const zobo = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.saleId!, productId: item.drink }, select: { id: true } });
    const refunded = await refundOrder({ orderId: order.main, lines: [{ saleItemId: zobo.id, quantity: 1 }], paymentType: "CASH", reason: "Too sweet", returnToStock: false, idempotencyKey: randomUUID() }, userId);
    assert.ok(refunded.ok, JSON.stringify(refunded));
    await prisma.saleReturn.updateMany({ where: { saleId: sale.saleId! }, data: { createdAt: at("2030-03-10T21:00:00Z") } });

    // Waste on the 10th: ₦7.50 active, ₦100 voided.
    const waste = { businessId: "default", warehouseId, productId: item.rice, qty: 1, unit: "pc", reason: "BURNT" as const, loggedById: userId, createdAt: at("2030-03-10T10:00:00Z") };
    await prisma.wasteEntry.create({ data: { ...waste, costSnapshot: "7.50" } });
    await prisma.wasteEntry.create({ data: { ...waste, costSnapshot: "100.00", status: "VOID" } });
  });
  after(() => prisma.$disconnect());

  test("settle records each sold line's cost; no cost when an ingredient has none", async () => {
    const lines = await prisma.orderItem.findMany({ where: { orderId: { in: [order.main, order.small] } }, select: { productId: true, unitCost: true } });
    const cost = (id: string) => lines.filter((l) => l.productId === id).map((l) => l.unitCost?.toFixed(4) ?? null);
    assert.deepEqual(cost(item.food), ["9.0000"], "the recipe: 2 × 2.50 + 4.00");
    assert.deepEqual(cost(item.drink), ["3.0000"], "no recipe: its own cost");
    assert.deepEqual(cost(item.nocost), [null], "salt has no cost");
  });

  test("the migration's backfill gives what settle recorded", async () => {
    const backfill = readFileSync(join(process.cwd(), "prisma/migrations/20261112170000_add_order_item_cost/migration.sql"), "utf8");
    const update = backfill.slice(backfill.indexOf("UPDATE `OrderItem`")).trim().replace(/;$/, "");
    const before = await prisma.orderItem.findMany({ where: { orderId: order.main }, select: { id: true, unitCost: true } });
    await prisma.orderItem.updateMany({ where: { orderId: order.main }, data: { unitCost: null } });
    assert.ok((await prisma.$executeRawUnsafe(update)) >= 2);
    const after = await prisma.orderItem.findMany({ where: { orderId: order.main }, select: { id: true, unitCost: true } });
    assert.deepEqual(after.map((l) => [l.id, l.unitCost?.toFixed(4)]).sort(), before.map((l) => [l.id, l.unitCost?.toFixed(4)]).sort());
  });

  test("the overview: net sales = the Sales' totals − refunds; tips apart; training left out", async () => {
    const window = windowFor("2030-03-10", "2030-03-10");
    const result = await getOverview(window, mine(), { dayStartMinutes: 0, withCost: true });
    assert.ok(result.ok);
    const t = result.data.current;
    // What the retail side holds for the same two bills.
    const sales = await prisma.sale.findMany({ where: { order: { id: { in: [order.main, order.small] } } }, select: { grandTotal: true } });
    const retailTotal = sales.reduce((s, x) => s + Number(x.grandTotal), 0).toFixed(2);
    assert.equal(t.sales.toFixed(2), retailTotal, "the same as the Sales");
    assert.equal(t.sales.toFixed(2), "65.00");
    assert.equal(t.refunds.toFixed(2), "10.00");
    assert.equal(t.net.toFixed(2), "55.00");
    assert.equal(t.tips.toFixed(2), "5.00");
    assert.deepEqual([t.orders, t.covers], [2, 4]);
    const counted = await countSettledOrders(window, mine());
    assert.ok(counted.ok && counted.data === t.orders, "the shell's count agrees");
    // 2 × ₦9 + ₦3; the pepper soup has no cost.
    assert.deepEqual([t.cost?.total.toFixed(2), t.cost?.quantity, t.cost?.missingQuantity], ["21.00", 4, 1]);
    assert.deepEqual([t.waste.toFixed(2), t.wasteEntries], ["7.50", 1], "ACTIVE waste only");
    assert.deepEqual(netByHour(result.data.sales, result.data.refunds), [
      { hour: 13, total: "15.00" },
      { hour: 20, total: "50.00" },
      { hour: 22, total: "-10.00" },
    ]);
    // Food: 2 × Jollof; the Zobo sold and returned; the pepper soup isn't on a button.
    assert.deepEqual(netByDepartment(result.data.departments.sold, result.data.departments.returned), [
      { department: "FOOD", net: "40.00" },
      { department: "NONE", net: "15.00" },
    ]);
    // The equal period before: 9 March.
    assert.deepEqual([result.data.previous.orders, result.data.previous.sales.toFixed(2)], [1, "10.00"]);
  });

  test("without View Cost, cost isn't worked out at all", async () => {
    const result = await getOverview(windowFor("2030-03-10", "2030-03-10"), mine(), { dayStartMinutes: 0, withCost: false });
    assert.ok(result.ok);
    assert.equal(result.data.current.cost, null);
    assert.equal(result.data.previous.cost, null);
  });

  test("the refund lowers the period it was made in", async () => {
    // Moved to the 11th: the 10th has the whole bill again, the 11th the refund.
    const sale = await prisma.order.findUniqueOrThrow({ where: { id: order.main }, select: { saleId: true } });
    await prisma.saleReturn.updateMany({ where: { saleId: sale.saleId! }, data: { createdAt: at("2030-03-11T09:00:00Z") } });
    const tenth = await getOverview(windowFor("2030-03-10", "2030-03-10"), mine(), { dayStartMinutes: 0, withCost: false });
    const eleventh = await getOverview(windowFor("2030-03-11", "2030-03-11"), mine(), { dayStartMinutes: 0, withCost: false });
    assert.ok(tenth.ok && eleventh.ok);
    assert.equal(tenth.data.current.net.toFixed(2), "65.00");
    assert.deepEqual([eleventh.data.current.orders, eleventh.data.current.net.toFixed(2)], [0, "-10.00"]);
  });

  test("a 04:00 day start moves an order closed at 01:30 to the day before", async () => {
    const late = await settled([item.drink], { closedAt: at("2030-03-11T00:30:00Z") });
    const midnight = await getOverview(windowFor("2030-03-10", "2030-03-10"), mine(), { dayStartMinutes: 0, withCost: false });
    const four = await getOverview(parseReportFilters({ from: "2030-03-10", to: "2030-03-10" }, { dayStartMinutes: 240, now: at("2030-03-10T12:00:00Z") }).window, mine(), { dayStartMinutes: 240, withCost: false });
    assert.ok(midnight.ok && four.ok);
    assert.equal(four.data.current.orders, midnight.data.current.orders + 1);
    assert.ok(four.data.sales.some((r) => r.day === "2030-03-10" && r.hour === 1), "counted on the 10th, at 01:00 on the clock");
    assert.ok(late);
  });
});
