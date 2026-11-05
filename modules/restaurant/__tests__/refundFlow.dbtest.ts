// Refunds of settled bills (services/refund.ts refundOrder) against a real
// database: retail Sale Returns through retail's return code, stock back by
// the recipe as settled, shares that add up, retries, races, and retail's
// own return form refusing restaurant sales. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/refundFlow.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveNewSale } from "@/app/(dashboard)/sales/save-sale";
import { restaurantSaleRefusal } from "@/app/(dashboard)/sales/returns/save-return";
import { newQrToken } from "../lib/qrToken";
import type { RefundInput } from "../schemas/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { applyOrderDiscount } from "../server/services/bill";
import { settleOrder } from "../server/services/settle";
import { refundOrder, type RefundResult } from "../server/services/refund";
import { getRefundView } from "../server/queries/refund";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let warehouseId = "";
let tableCount = 0;
const id: Record<"jollof" | "chapman" | "rice" | "chicken", string> = { jollof: "", chapman: "", rice: "", chicken: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
const stock = async (productId: string) => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).quantity;
const stocks = async () => ({ rice: await stock(id.rice), chicken: await stock(id.chicken), chapman: await stock(id.chapman), jollof: await stock(id.jollof) });
async function tap(orderId: string, productId: string) {
  assert.ok((await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null })).ok);
}
// 2× Jollof (250 g rice + 1 chicken each) + 1× Chapman, sent and settled.
async function settledOrder({ discount = false } = {}) {
  tableCount += 1;
  const table = await prisma.table.create({ data: { name: `R${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  const orderId = opened.orderId;
  await tap(orderId, id.jollof);
  await tap(orderId, id.jollof);
  await tap(orderId, id.chapman);
  assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
  if (discount) assert.ok((await applyOrderDiscount({ orderId, version: await versionOf(orderId), type: "PERCENT", value: "10", reason: "Regular" }, userId)).ok);
  const settled = await settleOrder({ orderId, version: await versionOf(orderId), payments: [{ paymentType: "CASH", amount: "100" }], tip: "0", idempotencyKey: randomUUID() }, userId);
  assert.ok(settled.ok, JSON.stringify(settled));
  const lines = await prisma.saleItem.findMany({ where: { saleId: settled.saleId }, select: { id: true, productId: true } });
  const saleItem = (productId: string) => lines.find((l) => l.productId === productId)!.id;
  return { orderId, saleId: settled.saleId, jollof: saleItem(id.jollof), chapman: saleItem(id.chapman) };
}
const refund = (orderId: string, lines: RefundInput["lines"], extra: Partial<RefundInput> = {}) =>
  refundOrder({ orderId, lines, returnToStock: false, paymentType: "CASH", reason: "Served cold", idempotencyKey: randomUUID(), ...extra }, userId);
const ok = (r: RefundResult) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

describe("Refunds (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 10 } });
    if (!(await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null } }))) await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true } });
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Refund check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Refund check" }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, price: string, orderTax: string | null, productType: "MENU_ITEM" | "INGREDIENT", quantity: number) => {
      id[key] = (await prisma.product.create({ data: { name: `RF ${key}`, code: `RF-${key}-${Date.now()}`, price, orderTax, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType }, select: { id: true } })).id;
      await prisma.productStock.create({ data: { productId: id[key], warehouseId, quantity } });
    };
    await make("jollof", "18.00", null, "MENU_ITEM", 5);
    await make("chapman", "10.00", "7.5", "MENU_ITEM", 50);
    await make("rice", "0", null, "INGREDIENT", 100000);
    await make("chicken", "0", null, "INGREDIENT", 1000);
    await prisma.recipeLine.createMany({
      data: [
        { id: "rf-rice", menuItemId: id.jollof, ingredientId: id.rice, quantity: 250 },
        { menuItemId: id.jollof, ingredientId: id.chicken, quantity: 1 },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("settle records what one of each dish took, as settled", async () => {
    const { orderId } = await settledOrder();
    const lines = await prisma.orderItem.findMany({ where: { orderId, deletedAt: null }, select: { productId: true, stockPerUnit: true } });
    const of = (productId: string) => lines.find((l) => l.productId === productId)!.stockPerUnit as { productId: string; quantity: number }[];
    assert.deepEqual(of(id.jollof).map((m) => [m.productId, m.quantity]).sort(), [[id.rice, 250], [id.chicken, 1]].sort());
    assert.deepEqual(of(id.chapman).map((m) => [m.productId, m.quantity]), [[id.chapman, 1]]);
  });

  test("a refund returned to stock: a retail Sale Return, paid back; the dish's ingredients back in", async () => {
    const order = await settledOrder();
    const before = await stocks();
    const result = ok(await refund(order.orderId, [{ saleItemId: order.jollof, quantity: 1 }], { returnToStock: true, paymentType: "CARD" }));
    // ₦18 of ₦46.75 with its share of the ₦4.60 service charge (no discount): 18 + 1.77.
    assert.deepEqual([/^SR_/.test(result.reference), result.amount, result.returnedToStock], [true, "19.77", true]);
    const ret = await prisma.saleReturn.findUniqueOrThrow({ where: { id: result.saleReturnId }, include: { items: true, payments: true } });
    assert.deepEqual(
      [ret.saleId, ret.status, ret.grandTotal.toFixed(2), ret.paid.toFixed(2), ret.due.toFixed(2), ret.paymentStatus, ret.shipping.toFixed(2), ret.discount.toFixed(2)],
      [order.saleId, "COMPLETED", "19.77", "19.77", "0.00", "PAID", "1.77", "0.00"],
    );
    assert.deepEqual(ret.items.map((i) => [i.saleItemId, i.productId, i.quantity, i.netUnitPrice.toFixed(2)]), [[order.jollof, id.jollof, 1, "18.00"]]);
    assert.deepEqual(ret.payments.map((p) => [p.paymentType, p.amount.toFixed(2)]), [["CARD", "19.77"]]);
    assert.match(ret.notes ?? "", /^Restaurant ORD-\d{4} refund · Served cold · returned to stock$/);
    const after = await stocks();
    assert.deepEqual([after.rice - before.rice, after.chicken - before.chicken, after.jollof - before.jollof, after.chapman - before.chapman], [250, 1, 0, 0], "the ingredients, not the dish");
    const recorded = await prisma.orderRefund.findUniqueOrThrow({ where: { saleReturnId: result.saleReturnId } });
    assert.deepEqual([recorded.orderId, recorded.returnedToStock, (recorded.stockMoves as { quantity: number }[]).map((m) => m.quantity).sort((a, b) => a - b)], [order.orderId, true, [1, 250]]);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status, "BILLED", "never reopened");
  });

  test("as settled: a recipe changed since doesn't change what goes back", async () => {
    const order = await settledOrder();
    await prisma.recipeLine.update({ where: { id: "rf-rice" }, data: { quantity: 400 } });
    try {
      const before = await stocks();
      ok(await refund(order.orderId, [{ saleItemId: order.jollof, quantity: 2 }], { returnToStock: true }));
      const after = await stocks();
      assert.deepEqual([after.rice - before.rice, after.chicken - before.chicken], [500, 2], "2 × 250 g as settled, not 2 × 400 g");
    } finally {
      await prisma.recipeLine.update({ where: { id: "rf-rice" }, data: { quantity: 250 } });
    }
  });

  test("not returned to stock: the refund, and no stock moves", async () => {
    const order = await settledOrder();
    const before = await stocks();
    const result = ok(await refund(order.orderId, [{ saleItemId: order.chapman, quantity: 1 }]));
    assert.deepEqual(await stocks(), before);
    const recorded = await prisma.orderRefund.findUniqueOrThrow({ where: { saleReturnId: result.saleReturnId } });
    assert.deepEqual([recorded.returnedToStock, recorded.stockMoves], [false, null]);
    assert.match((await prisma.saleReturn.findUniqueOrThrow({ where: { id: result.saleReturnId } })).notes ?? "", /not returned to stock$/);
  });

  test("refunds one at a time add up to the sale exactly (with a discount); then nothing is left", async () => {
    const order = await settledOrder({ discount: true });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: order.saleId } });
    const amounts = [
      ok(await refund(order.orderId, [{ saleItemId: order.jollof, quantity: 1 }])).amount,
      ok(await refund(order.orderId, [{ saleItemId: order.chapman, quantity: 1 }])).amount,
      ok(await refund(order.orderId, [{ saleItemId: order.jollof, quantity: 1 }])).amount,
    ];
    assert.equal(amounts.reduce((s, a) => s + Math.round(Number(a) * 100), 0) / 100, Number(sale.grandTotal), `${amounts.join(" + ")} = ${sale.grandTotal}`);
    const returns = await prisma.saleReturn.findMany({ where: { saleId: order.saleId } });
    assert.equal(returns.reduce((s, r) => s + Math.round(Number(r.discount) * 100), 0), Math.round(Number(sale.discount) * 100), "the discount shared out exactly");
    assert.equal(returns.reduce((s, r) => s + Math.round(Number(r.shipping) * 100), 0), Math.round(Number(sale.shipping) * 100), "the service charge too");
    const more = await refund(order.orderId, [{ saleItemId: order.jollof, quantity: 1 }]);
    assert.deepEqual(more, { ok: false, error: "Only 0 × RF jollof left to refund." });
    const view = await getRefundView(order.orderId);
    assert.deepEqual([view?.refunds.length, view?.lines.map((l) => l.sold - l.returned)], [3, [0, 0]]);
  });

  test("refused: an order not settled; nothing written", async () => {
    tableCount += 1;
    const table = await prisma.table.create({ data: { name: `R${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
    const opened = await openTableOrder(table.id, userId);
    assert.ok(opened.ok);
    const returns = await prisma.saleReturn.count();
    assert.deepEqual(await refund(opened.orderId, [{ saleItemId: "x", quantity: 1 }]), { ok: false, error: "Only a settled bill can be refunded." });
    assert.equal(await prisma.saleReturn.count(), returns);
  });

  test("the same refund again: the first one's result; two refunds of the last dish at once: one goes through", async () => {
    const order = await settledOrder();
    const input: RefundInput = { orderId: order.orderId, lines: [{ saleItemId: order.chapman, quantity: 1 }], returnToStock: true, paymentType: "CASH", reason: "Spilt", idempotencyKey: randomUUID() };
    const first = ok(await refundOrder(input, userId));
    const before = { returns: await prisma.saleReturn.count(), stock: await stocks() };
    assert.deepEqual(await refundOrder(input, userId), first);
    assert.deepEqual({ returns: await prisma.saleReturn.count(), stock: await stocks() }, before);

    const both = await Promise.all([1, 2].map(() => refund(order.orderId, [{ saleItemId: order.jollof, quantity: 2 }])));
    assert.equal(both.filter((r) => r.ok).length, 1, JSON.stringify(both));
    assert.ok(both.some((r) => !r.ok && r.error === "Only 0 × RF jollof left to refund."));
  });

  test("retail's own return form refuses a restaurant sale (and only that)", async () => {
    const order = await settledOrder();
    const refusal = await restaurantSaleRefusal(order.saleId);
    assert.match(refusal ?? "", /^This sale is restaurant bill ORD-\d{4}\. Its refunds are made from the order/);
    const customerId = (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null } })).id;
    const retail = await saveNewSale(
      { date: "2026-11-05", status: "PENDING", warehouseId, customerId, orderTax: "0", discount: "0", shipping: "0", paidAmount: "0", paymentType: "CASH", items: [{ productId: id.chapman, quantity: 1, unitCost: "10", discountType: "FIXED", discount: "0", taxType: "EXCLUSIVE", taxRate: "0", purchaseUnit: "Pic" }] },
      userId,
    );
    assert.ok(retail.ok && "id" in retail);
    assert.equal(await restaurantSaleRefusal(retail.id as string), null);
    assert.equal(await restaurantSaleRefusal(null), null);
  });
});
