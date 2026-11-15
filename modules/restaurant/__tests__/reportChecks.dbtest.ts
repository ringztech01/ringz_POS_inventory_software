// Restaurant Reports, Step 12, against a real database (a throwaway copy):
// bills settled the real way on one day of their own (15 April 2031), then
// the reports against the retail Sales report's own query (getSaleList, as
// Reports › Sale and the Sales list use it) for the same Sales:
//   - net sales = the retail report's grand total, and the order count = its
//     count — a split bill is one order (one Sale), paid part by part;
//   - the split's payments are each part's own method, exactly what was due;
//   - a tip is never in net sales (nor in the retail grand total);
//   - a VOID line was never sold: not on the Sale, not in By dish;
//   - a training order makes no Sale and is in no report.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportChecks.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSaleList } from "@/app/(dashboard)/sales/queries";
import { parseDateParam } from "@/app/(dashboard)/purchases/queries";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, sendToKitchen } from "../server/services/orderFlow";
import { splitOrderBill } from "../server/services/bill";
import { settleOrder } from "../server/services/settle";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { countSettledOrders } from "../server/queries/reports/shell";
import { getOverview } from "../server/queries/reports/overview";
import { getDishReport } from "../server/queries/reports/dishes";
import { getPaymentsReport } from "../server/queries/reports/payments";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const DAY = "2031-04-15";
let userId = "";
let areaId = "";
const item: Record<"food" | "drink", string> = { food: "", drink: "" };
const order: Record<"voided" | "split" | "training", string> = { voided: "", split: "", training: "" };
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(2);

async function sentOrder(lines: string[]) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RC${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  for (const [k, productId] of lines.entries()) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId, modifierIds: [], note: `line ${k}` })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  return opened.orderId;
}
const settle = async (orderId: string, input: { partId?: string; payments: { paymentType: "CASH" | "CARD"; amount: string }[]; tip?: string }) => {
  const done = await settleOrder({ orderId, version: await versionOf(orderId), partId: input.partId, payments: input.payments, tip: input.tip ?? "0", idempotencyKey: randomUUID() }, userId);
  assert.ok(done.ok, JSON.stringify(done));
  return done;
};

const mine = (): ReportFilters => ({ area: null, waiter: userId, type: null, station: null, device: null });
const window = () => parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0, now: new Date(`${DAY}T20:00:00Z`) }).window;

describe("Reports against the retail Sales report (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Rita", lastName: "Checks", email: `rita-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Step 12 check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Step 12 check" }, select: { id: true } })).id;
    const make = async (name: string, price: string) => {
      const p = await prisma.product.create({ data: { name, code: `RC-${name}-${Date.now()}`, price, cost: "1.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 100 } });
      return p.id;
    };
    item.food = await make("RC Suya", "20.00");
    item.drink = await make("RC Chapman", "10.00");

    // ₦40: two Suya and a Chapman, the Chapman voided after it was sent; paid
    // ₦45 cash, ₦5 of it a tip.
    order.voided = await sentOrder([item.food, item.food, item.drink]);
    const chapman = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.voided, productId: item.drink }, select: { id: true } });
    assert.ok((await cancelLine({ orderId: order.voided, lineId: chapman.id, version: await versionOf(order.voided), reason: "WRONG_ITEM", details: null }, userId, { mayVoid: true })).ok);
    await settle(order.voided, { payments: [{ paymentType: "CASH", amount: "45" }], tip: "5" });

    // ₦30 split two ways: ₦15 by card, ₦15 cash (₦20 tendered, ₦5 change).
    order.split = await sentOrder([item.food, item.drink]);
    assert.ok((await splitOrderBill(order.split, await versionOf(order.split), { mode: "EQUAL", ways: 2 })).ok);
    const parts = await prisma.orderBillPart.findMany({ where: { orderId: order.split, deletedAt: null }, orderBy: { number: "asc" }, select: { id: true } });
    assert.equal(parts.length, 2);
    await settle(order.split, { partId: parts[0].id, payments: [{ paymentType: "CARD", amount: "15" }] });
    await settle(order.split, { partId: parts[1].id, payments: [{ paymentType: "CASH", amount: "20" }] });

    // A training order: settled, nothing real.
    order.training = await sentOrder([item.food]);
    await prisma.order.update({ where: { id: order.training }, data: { training: true } });
    const training = await settle(order.training, { payments: [{ paymentType: "CASH", amount: "20" }] });
    assert.equal(training.ok && training.saleId, "", "no Sale");

    // All on the 15th (settle stamps today): the orders' close, the Sales'
    // date (what the retail report filters on), the payments.
    const ids = [order.voided, order.split, order.training];
    await prisma.order.updateMany({ where: { id: { in: ids } }, data: { closedAt: new Date(`${DAY}T13:00:00Z`) } });
    const saleIds = (await prisma.order.findMany({ where: { id: { in: ids } }, select: { saleId: true } })).map((o) => o.saleId).filter((s): s is string => !!s);
    await prisma.sale.updateMany({ where: { id: { in: saleIds } }, data: { date: parseDateParam(DAY)!, createdAt: new Date(`${DAY}T13:00:00Z`) } });
    await prisma.salePayment.updateMany({ where: { saleId: { in: saleIds } }, data: { date: parseDateParam(DAY)! } });
    await prisma.orderTip.updateMany({ where: { orderId: { in: ids } }, data: { createdAt: new Date(`${DAY}T13:00:00Z`) } });
  });
  after(() => prisma.$disconnect());

  test("the setup: the split bill is one Sale; the training order none; the void not on its Sale", async () => {
    const sales = await prisma.order.findMany({ where: { id: { in: [order.voided, order.split, order.training] } }, select: { id: true, saleId: true, sale: { select: { grandTotal: true, items: { select: { productId: true, quantity: true } } } } } });
    const of = (id: string) => sales.find((s) => s.id === id)!;
    assert.equal(of(order.training).saleId, null);
    assert.equal(money(of(order.split).sale!.grandTotal), "30.00");
    assert.equal(await prisma.orderSettlement.count({ where: { orderId: order.split } }), 2, "two settlements, one Sale");
    assert.deepEqual(of(order.voided).sale!.items.map((i) => [i.productId, i.quantity]), [[item.food, 2]], "the voided Chapman isn't on the Sale");
    assert.equal(money(of(order.voided).sale!.grandTotal), "40.00", "the tip isn't on it either");
  });

  test("restaurant net sales = the retail Sales report's grand total; orders = its count (a split bill counts once)", async () => {
    const retail = await getSaleList({ from: DAY, to: DAY, perPage: 100 });
    assert.equal(retail.total, 2);
    assert.equal(money(retail.totals.grandTotal), "70.00");
    const overview = await getOverview(window(), mine(), { dayStartMinutes: 0, withCost: false });
    assert.ok(overview.ok);
    const t = overview.data.current;
    assert.deepEqual([t.orders, money(t.sales), money(t.refunds), money(t.net)], [retail.total, money(retail.totals.grandTotal), "0.00", money(retail.totals.grandTotal)]);
    const count = await countSettledOrders(window(), mine());
    assert.ok(count.ok);
    assert.equal(count.data, 2, "the shell's count: the split bill once, the training order never");
  });

  test("tips are apart: ₦5 in tips, not in net sales", async () => {
    const overview = await getOverview(window(), mine(), { dayStartMinutes: 0, withCost: false });
    assert.ok(overview.ok);
    assert.deepEqual([money(overview.data.current.tips), money(overview.data.current.net)], ["5.00", "70.00"]);
  });

  test("the split's payments: each part by its own method, exactly what was due (no change, no tips)", async () => {
    const payments = await getPaymentsReport(window(), mine());
    assert.ok(payments.ok);
    const by = Object.fromEntries(payments.data.methods.filter((m) => Number(m.count) > 0).map((m) => [m.method, [m.count, money(m.amount)]]));
    assert.deepEqual(by, { CASH: [2, "55.00"], CARD: [1, "15.00"] }, "cash ₦40 + ₦15, card ₦15");
    const total = payments.data.methods.reduce((s, m) => s.plus(m.amount), new Prisma.Decimal(0));
    assert.equal(money(total), "70.00", "the methods add up to net sales");
    assert.deepEqual(payments.data.tipsByMethod.filter((m) => Number(m.count) > 0).map((m) => [m.method, money(m.amount)]), [["CASH", "5.00"]]);
  });

  test("By dish: the VOID line was never sold; the training order isn't there", async () => {
    const dishes = await getDishReport(window(), mine(), { withCost: false });
    assert.ok(dishes.ok);
    const qty = Object.fromEntries(dishes.data.sales.map((s) => [s.productId, s.quantity]));
    assert.deepEqual(qty, { [item.food]: 3, [item.drink]: 1 }, "Suya 2 + 1 (not the training one), Chapman only the split's");
    const gross = dishes.data.sales.reduce((s, d) => s.plus(d.gross), new Prisma.Decimal(0));
    assert.equal(money(gross), "70.00");
  });
});
