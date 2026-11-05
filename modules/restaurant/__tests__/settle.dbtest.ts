// Settle's server-side checks (services/settle.ts planSettlement, via
// checkSettlement) against a real database. Step 4: checks only — nothing
// is written. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/settle.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import type { SettleInput } from "../schemas/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { changeOrderDetails, ORDER_CLOSED, STALE } from "../server/services/orders";
import { splitOrderBill } from "../server/services/bill";
import { checkSettlement, PART_GONE, type SettlementPlan } from "../server/services/settle";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let tableCount = 0;
const dish: Record<"jollof" | "chapman", string> = { jollof: "", chapman: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function newOrder() {
  tableCount += 1;
  const table = await prisma.table.create({ data: { name: `P${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  return opened.orderId;
}
async function tap(orderId: string, productId: string) {
  assert.ok((await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null })).ok);
}
// 2× Jollof ₦18 + 1× Chapman ₦10 (7.5% tax), sent: ₦51.35 with the 10% service charge.
async function billedOrder() {
  const orderId = await newOrder();
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.chapman);
  assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
  return orderId;
}
const settle = async (orderId: string, input: Partial<SettleInput> = {}) =>
  checkSettlement({ orderId, version: await versionOf(orderId), payments: [{ paymentType: "CASH", amount: "60" }], tip: "0", idempotencyKey: randomUUID(), ...input });
const plan = (p: SettlementPlan) =>
  p.ok
    ? { due: p.due.toFixed(2), change: p.tender.change.toFixed(2), payments: p.tender.payments.map((x) => [x.paymentType, x.amount.toFixed(2)]), tips: p.tender.tips.map((x) => [x.paymentType, x.amount.toFixed(2)]), partId: p.partId }
    : p;

describe("Settle checks (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 10 } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Settle check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Settle check" }, select: { id: true } })).id;
    const make = async (name: string, price: string, orderTax: string) => {
      const product = await prisma.product.create({
        data: { name, code: `PC-${name}-${Date.now()}`, price, orderTax, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.jollof = await make("PC Jollof", "18.00", "0");
    dish.chapman = await make("PC Chapman", "10.00", "7.5");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("the whole bill: the server's total, change out of the cash; nothing written", async () => {
    const orderId = await billedOrder();
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const [sales, stock] = [await prisma.sale.count(), await prisma.productStock.findMany({ orderBy: { id: "asc" }, select: { id: true, quantity: true } })];
    assert.deepEqual(plan(await settle(orderId)), { due: "51.35", change: "8.65", payments: [["CASH", "51.35"]], tips: [], partId: null });
    assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: orderId } }), before, "the order is untouched");
    assert.equal(await prisma.sale.count(), sales, "no Sale");
    assert.deepEqual(await prisma.productStock.findMany({ orderBy: { id: "asc" }, select: { id: true, quantity: true } }), stock, "no stock moved");
  });

  test("short, overpaid by card, stale, closed, unsent", async () => {
    const orderId = await billedOrder();
    assert.deepEqual(await settle(orderId, { payments: [{ paymentType: "CASH", amount: "50" }] }), { ok: false, error: "₦1.35 still to pay." });
    const overCard = await settle(orderId, { payments: [{ paymentType: "CARD", amount: "60" }] });
    assert.ok(!overCard.ok && overCard.error.includes("Change only comes from cash"));
    assert.deepEqual(await checkSettlement({ orderId, version: (await versionOf(orderId)) - 1, payments: [{ paymentType: "CASH", amount: "60" }], tip: "0", idempotencyKey: randomUUID() }), { ok: false, error: STALE, stale: true });

    await tap(orderId, dish.jollof);
    assert.deepEqual(await settle(orderId), { ok: false, error: "1 line hasn't been sent to the kitchen. Send or remove it first." });

    const billed = await billedOrder();
    await prisma.order.update({ where: { id: billed }, data: { status: "BILLED", closedAt: new Date() } });
    assert.deepEqual(await settle(billed), { ok: false, error: ORDER_CLOSED, stale: true }, "already settled: refused");
    const empty = await newOrder();
    assert.deepEqual(await settle(empty), { ok: false, error: "Nothing to bill yet." });
  });

  test("a tip: needs the order's waiter; kept apart from the sale's payments", async () => {
    const orderId = await billedOrder();
    await prisma.order.update({ where: { id: orderId }, data: { waiterId: null } });
    assert.deepEqual(await settle(orderId, { tip: "5" }), { ok: false, error: "Tips go to the waiter — choose the waiter on the order first." });
    assert.ok((await changeOrderDetails(orderId, await versionOf(orderId), { field: "waiterId", value: userId })).ok);
    assert.deepEqual(plan(await settle(orderId, { tip: "5", payments: [{ paymentType: "CASH", amount: "40" }, { paymentType: "CARD", amount: "16.35" }] })), {
      due: "51.35",
      change: "0.00",
      payments: [
        ["CASH", "40.00"],
        ["CARD", "11.35"],
      ],
      tips: [["CARD", "5.00"]],
      partId: null,
    });
    // The tip has to be covered as well as the bill.
    assert.deepEqual(await settle(orderId, { tip: "5", payments: [{ paymentType: "CASH", amount: "51.35" }] }), { ok: false, error: "₦5.00 still to pay." });
  });

  test("a split bill: each part on its own, at the part's amount; a paid part doesn't block the next", async () => {
    const orderId = await billedOrder();
    assert.ok((await splitOrderBill(orderId, await versionOf(orderId), { mode: "EQUAL", ways: 3 })).ok);
    const parts = await prisma.orderBillPart.findMany({ where: { orderId, deletedAt: null }, orderBy: { number: "asc" } });
    assert.deepEqual(await settle(orderId), { ok: false, error: "This bill is split — pay it one part at a time.", stale: true });
    assert.deepEqual(plan(await settle(orderId, { partId: parts[2].id, payments: [{ paymentType: "CASH", amount: "20" }] })), {
      due: "17.13",
      change: "2.87",
      payments: [["CASH", "17.13"]],
      tips: [],
      partId: parts[2].id,
    });
    await prisma.orderBillPart.update({ where: { id: parts[0].id }, data: { status: "PAID", paidAt: new Date() } });
    assert.deepEqual(await settle(orderId, { partId: parts[0].id }), { ok: false, error: "That part has already been paid — refreshed.", stale: true });
    assert.ok((await settle(orderId, { partId: parts[1].id })).ok, "the next part can still be paid");

    const other = await billedOrder();
    assert.ok((await splitOrderBill(other, await versionOf(other), { mode: "EQUAL", ways: 2 })).ok);
    const foreign = await prisma.orderBillPart.findFirstOrThrow({ where: { orderId: other, deletedAt: null } });
    assert.deepEqual(await settle(orderId, { partId: foreign.id }), { ok: false, error: PART_GONE, stale: true }, "another order's part");
    const unsplit = await billedOrder();
    assert.deepEqual(await settle(unsplit, { partId: parts[1].id }), { ok: false, error: PART_GONE, stale: true });
  });

  test("a split that no longer adds up can't be paid", async () => {
    const orderId = await billedOrder();
    assert.ok((await splitOrderBill(orderId, await versionOf(orderId), { mode: "EQUAL", ways: 2 })).ok);
    const part = await prisma.orderBillPart.findFirstOrThrow({ where: { orderId, deletedAt: null } });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantServiceChargePercent: 12.5 } });
    try {
      assert.deepEqual(await settle(orderId, { partId: part.id }), { ok: false, error: "The split no longer adds up to the bill. Split it again before taking payment." });
    } finally {
      await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantServiceChargePercent: 10 } });
    }
  });
});
