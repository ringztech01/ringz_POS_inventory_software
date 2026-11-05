// Settle (services/settle.ts settleOrder) against a real database: the
// order's Sale through retail's saveSaleInTx, stock through
// resolveStockLines, split parts, tips, idempotent retries and races.
// Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/settleFlow.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/format";
import { newQrToken } from "../lib/qrToken";
import { resolveStockLines } from "../lib/resolveStockLines";
import type { SettleInput } from "../schemas/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine, setLineQuantity } from "../server/services/orderLines";
import { cancelLine, markLinesServed, sendToKitchen } from "../server/services/orderFlow";
import { advanceLine } from "../server/services/kitchen";
import { changeOrderDetails, ORDER_CLOSED, PART_PAID, STALE } from "../server/services/orders";
import { applyOrderDiscount, clearOrderSplit, registerBillPrint, setOrderServiceCharge, splitOrderBill } from "../server/services/bill";
import { settleOrder, type SettleResult } from "../server/services/settle";
import { getReceiptExtras } from "../server/queries/receipt";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let waiterName = "";
let areaId = "";
let warehouseId = "";
let walkInId = "";
let tableCount = 0;
const id: Record<"jollof" | "chapman" | "rice" | "chicken" | "pilau", string> = { jollof: "", chapman: "", rice: "", chicken: "", pilau: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
const stock = async (productId: string) => (await prisma.productStock.findFirst({ where: { productId, warehouseId } }))?.quantity ?? null;
const stocks = async () => ({ rice: await stock(id.rice), chicken: await stock(id.chicken), chapman: await stock(id.chapman), jollof: await stock(id.jollof) });
async function newTable() {
  tableCount += 1;
  return (await prisma.table.create({ data: { name: `T${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } })).id;
}
async function newOrder() {
  const opened = await openTableOrder(await newTable(), userId);
  assert.ok(opened.ok);
  return opened.orderId;
}
async function tap(orderId: string, productId: string) {
  const result = await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null });
  assert.ok(result.ok, JSON.stringify(result));
}
// 2× Jollof ₦18 (recipe: 250 g rice + 1 chicken) + 1× Chapman ₦10 (7.5% tax, own stock), sent: ₦51.35.
async function billedOrder() {
  const orderId = await newOrder();
  await tap(orderId, id.jollof);
  await tap(orderId, id.jollof);
  await tap(orderId, id.chapman);
  assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
  return orderId;
}
const pay = (paymentType: "CASH" | "CARD" | "BANK_TRANSFER", amount: string) => ({ paymentType, amount });
const settle = async (orderId: string, input: Partial<SettleInput> = {}) =>
  settleOrder({ orderId, version: await versionOf(orderId), payments: [pay("CASH", "60")], tip: "0", idempotencyKey: randomUUID(), ...input }, userId);
const ok = (r: SettleResult) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const saleOf = async (saleId: string) => {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true, payments: { where: { deletedAt: null }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] } } });
  const name = (productId: string) => Object.entries(id).find(([, v]) => v === productId)?.[0];
  return {
    status: sale.status,
    customer: sale.customerId === walkInId ? "walk-in" : sale.customerId,
    warehouse: sale.warehouseId === warehouseId,
    discount: sale.discount.toFixed(2),
    shipping: sale.shipping.toFixed(2),
    orderTax: sale.orderTax.toFixed(2),
    grandTotal: sale.grandTotal.toFixed(2),
    paid: sale.paid.toFixed(2),
    due: sale.due.toFixed(2),
    paymentStatus: sale.paymentStatus,
    notes: sale.notes,
    items: sale.items.map((i) => [name(i.productId), i.quantity, i.netUnitPrice.toFixed(2), i.orderTax.toFixed(2), i.subtotal.toFixed(2)]).sort(),
    payments: sale.payments.map((p) => [p.paymentType, p.amount.toFixed(2), p.notes]),
  };
};

describe("Settle (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true, firstName: true } });
    userId = admin.id;
    waiterName = admin.firstName;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 10 } });
    walkInId =
      (await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null }, select: { id: true } }))?.id ??
      (await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true }, select: { id: true } })).id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Settle flow", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Settle flow" }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, price: string, orderTax: string | null, productType: "MENU_ITEM" | "INGREDIENT", quantity: number) => {
      id[key] = (await prisma.product.create({ data: { name: `SF ${key}`, code: `SF-${key}-${Date.now()}`, price, orderTax, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType }, select: { id: true } })).id;
      await prisma.productStock.create({ data: { productId: id[key], warehouseId, quantity } });
    };
    await make("jollof", "18.00", null, "MENU_ITEM", 5);
    await make("chapman", "10.00", "7.5", "MENU_ITEM", 50);
    await make("pilau", "15.00", null, "MENU_ITEM", 5);
    await make("rice", "0", null, "INGREDIENT", 100000);
    await make("chicken", "0", null, "INGREDIENT", 1000);
    await prisma.recipeLine.createMany({
      data: [
        { menuItemId: id.jollof, ingredientId: id.rice, quantity: 250 },
        { menuItemId: id.jollof, ingredientId: id.chicken, quantity: 1 },
        // Saved before recipes took whole units: a part unit.
        { menuItemId: id.pilau, ingredientId: id.rice, quantity: "0.25" },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("stock moves only at settle: nothing through the whole life of an order before it; then exactly the billed lines (never a VOID one)", async () => {
    const allStock = () => prisma.productStock.findMany({ orderBy: { id: "asc" }, select: { id: true, quantity: true } });
    const untouched = await allStock();
    const still = async (what: string) => assert.deepEqual(await allStock(), untouched, `${what}: no stock moved`);
    const v = (orderId: string) => versionOf(orderId);

    const orderId = await newOrder();
    await tap(orderId, id.jollof);
    await tap(orderId, id.jollof);
    await tap(orderId, id.chapman);
    await tap(orderId, id.pilau);
    const pilau = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: id.pilau }, select: { id: true } });
    assert.ok((await setLineQuantity({ orderId, version: await v(orderId), lineId: pilau.id, quantity: 0 })).ok);
    await still("adding and removing lines");
    assert.ok((await sendToKitchen(orderId, await v(orderId), userId)).ok);
    await still("Send to kitchen");
    const chapman = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: id.chapman }, select: { id: true } });
    assert.deepEqual(await advanceLine(chapman.id, "PENDING"), { ok: true });
    assert.deepEqual(await advanceLine(chapman.id, "PREPARING"), { ok: true });
    assert.ok((await markLinesServed(orderId, await v(orderId), [chapman.id])).ok);
    await still("the kitchen and Served");
    // A Chapman added, sent, then cancelled (VOID).
    await tap(orderId, id.chapman);
    assert.ok((await sendToKitchen(orderId, await v(orderId), userId)).ok);
    const voided = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: id.chapman, kitchenStatus: "PENDING" }, select: { id: true } });
    assert.ok((await cancelLine({ orderId, version: await v(orderId), lineId: voided.id, reason: "WRONG_ITEM", details: null }, userId)).ok);
    await still("a VOID line");
    assert.ok((await applyOrderDiscount({ orderId, version: await v(orderId), type: "PERCENT", value: "5", reason: "x" }, userId)).ok);
    assert.ok((await setOrderServiceCharge(orderId, await v(orderId), false)).ok);
    assert.ok((await setOrderServiceCharge(orderId, await v(orderId), true)).ok);
    assert.ok((await splitOrderBill(orderId, await v(orderId), { mode: "EQUAL", ways: 2 })).ok);
    assert.ok((await clearOrderSplit(orderId, await v(orderId))).ok);
    assert.ok((await registerBillPrint(orderId)).ok);
    await still("discount, service charge, split, print");
    const stale = await settleOrder({ orderId, version: (await v(orderId)) - 1, payments: [pay("CASH", "60")], tip: "0", idempotencyKey: randomUUID() }, userId);
    assert.equal(stale.ok, false);
    await still("a refused settle");

    ok(await settle(orderId));
    const after = await allStock();
    const moved = new Map(untouched.map((row) => [row.id, row.quantity - (after.find((a) => a.id === row.id)?.quantity ?? row.quantity)]));
    const rowOf = async (productId: string) => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).id;
    const expected = new Map(
      resolveStockLines([
        { productId: id.jollof, productName: "j", productType: "MENU_ITEM", quantity: 2, recipe: [{ ingredientId: id.rice, ingredientName: "r", quantity: 250 }, { ingredientId: id.chicken, ingredientName: "c", quantity: 1 }] },
        { productId: id.chapman, productName: "c", productType: "MENU_ITEM", quantity: 1 },
      ]).map((m) => [m.productId, m.quantity.toNumber()]),
    );
    for (const [productId, quantity] of expected) assert.equal(moved.get(await rowOf(productId)), quantity, `settle moved exactly ${quantity}`);
    assert.equal([...moved.values()].filter((n) => n !== 0).length, expected.size, "and nothing else — not the VOID Chapman, not the removed Pilau");
  });

  test("the whole bill: one Sale through retail's path, to the bill total; stock through the recipes; the order closes", async () => {
    const orderId = await billedOrder();
    const before = await stocks();
    const tableId = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).tableId;
    const result = ok(await settle(orderId));
    assert.deepEqual([result.closed, result.paid, result.change, /^SA_/.test(result.reference)], [true, "51.35", "8.65", true]);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.deepEqual([order.status, !!order.closedAt, order.saleId, order.activeTableId, order.version], ["BILLED", true, result.saleId, null, result.version]);
    assert.equal(await prisma.order.count({ where: { activeTableId: tableId } }), 0, "the table is free");
    assert.deepEqual(await saleOf(result.saleId), {
      status: "RECEIVED",
      customer: "walk-in",
      warehouse: true,
      discount: "0.00",
      shipping: "4.60",
      orderTax: "0.00",
      grandTotal: "51.35",
      paid: "51.35",
      due: "0.00",
      paymentStatus: "PAID",
      notes: `Restaurant ${"ORD-" + String(order.number).padStart(4, "0")} · Table T${tableCount} · Dine-in · Waiter: ${waiterName}`,
      items: [
        ["chapman", 1, "10.00", "7.50", "10.75"],
        ["jollof", 2, "18.00", "0.00", "36.00"],
      ],
      payments: [["CASH", "51.35", null]],
    });

    // Stock: exactly what resolveStockLines says — the Jollof's recipe, the Chapman itself.
    const moves = resolveStockLines([
      { productId: id.jollof, productName: "SF jollof", productType: "MENU_ITEM", quantity: 2, recipe: [{ ingredientId: id.rice, ingredientName: "rice", quantity: 250 }, { ingredientId: id.chicken, ingredientName: "chicken", quantity: 1 }] },
      { productId: id.chapman, productName: "SF chapman", productType: "MENU_ITEM", quantity: 1 },
    ]);
    const after = await stocks();
    for (const move of moves) {
      const key = Object.entries(id).find(([, v]) => v === move.productId)![0] as keyof typeof before;
      assert.equal(before[key]! - after[key]!, move.quantity.toNumber(), key);
    }
    assert.equal(after.jollof, before.jollof, "a dish with a recipe keeps its own stock");

    const settlement = await prisma.orderSettlement.findFirstOrThrow({ where: { orderId } });
    assert.deepEqual([settlement.partId, settlement.amount.toFixed(2), settlement.tip.toFixed(2), settlement.change.toFixed(2), settlement.closedOrder, settlement.version], [null, "51.35", "0.00", "8.65", true, result.version]);
    assert.deepEqual(await getReceiptExtras(result.saleId), { details: [["Order", "ORD-" + String(order.number).padStart(4, "0")], ["Table", `T${tableCount}`], ["Waiter", waiterName]], tips: [] });
  });

  test("the same payment again (its answer was lost): the first settle's result, nothing new", async () => {
    const orderId = await billedOrder();
    const key = randomUUID();
    const input = { orderId, version: await versionOf(orderId), payments: [pay("CASH", "51.35")], tip: "0", idempotencyKey: key };
    const first = ok(await settleOrder(input, userId));
    const [sales, payments, before] = [await prisma.sale.count(), await prisma.salePayment.count(), await stocks()];
    assert.deepEqual(await settleOrder(input, userId), first);
    assert.deepEqual([await prisma.sale.count(), await prisma.salePayment.count(), await stocks()], [sales, payments, before]);
    assert.equal(await prisma.orderSettlement.count({ where: { idempotencyKey: key } }), 1);
    // A key used on another order is refused.
    const other = await billedOrder();
    assert.deepEqual(await settleOrder({ ...input, orderId: other, version: await versionOf(other) }, userId), { ok: false, error: "That payment was for another order." });
  });

  test("two terminals at once: exactly one Sale; the other gets a clean refusal", async () => {
    for (let round = 0; round < 5; round++) {
      const orderId = await billedOrder();
      const version = await versionOf(orderId);
      const sales = await prisma.sale.count();
      const results = await Promise.all([1, 2].map(() => settleOrder({ orderId, version, payments: [pay("CASH", "51.35")], tip: "0", idempotencyKey: randomUUID() }, userId)));
      assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
      const refused = results.find((r) => !r.ok)!;
      assert.ok(!refused.ok && (refused.error === STALE || refused.error === ORDER_CLOSED));
      assert.equal(await prisma.sale.count(), sales + 1);
      // The same key from two tabs at once: one settle, both answered with it.
      const again = await billedOrder();
      const key = randomUUID();
      const v2 = await versionOf(again);
      const both = await Promise.all([1, 2].map(() => settleOrder({ orderId: again, version: v2, payments: [pay("CASH", "51.35")], tip: "0", idempotencyKey: key }, userId)));
      assert.ok(both.every((r) => r.ok), JSON.stringify(both));
      assert.equal(new Set(both.map((r) => r.ok && r.saleId)).size, 1);
      assert.equal(await prisma.sale.count(), sales + 2);
    }
  });

  test("not enough stock: retail's rule refuses it and nothing at all is written", async () => {
    const orderId = await billedOrder();
    await prisma.productStock.updateMany({ where: { productId: id.chicken, warehouseId }, data: { quantity: 1 } });
    try {
      const before = { stock: await stocks(), sales: await prisma.sale.count(), payments: await prisma.salePayment.count(), settlements: await prisma.orderSettlement.count(), order: await prisma.order.findUniqueOrThrow({ where: { id: orderId } }) };
      const result = await settle(orderId);
      assert.ok(!result.ok);
      assert.match(result.error, /^Not enough stock for SF chicken in .+ \(have 1, selling 2\)\.$/);
      assert.deepEqual(
        { stock: await stocks(), sales: await prisma.sale.count(), payments: await prisma.salePayment.count(), settlements: await prisma.orderSettlement.count(), order: await prisma.order.findUniqueOrThrow({ where: { id: orderId } }) },
        before,
      );
    } finally {
      await prisma.productStock.updateMany({ where: { productId: id.chicken, warehouseId }, data: { quantity: 1000 } });
    }
  });

  test("a recipe still in part units is refused (nothing written); the recipe form takes whole units now", async () => {
    const orderId = await newOrder();
    await tap(orderId, id.pilau);
    assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
    const sales = await prisma.sale.count();
    const result = await settle(orderId, { payments: [pay("CASH", "20")] });
    assert.deepEqual(result, { ok: false, error: "SF rice: a recipe uses part of a unit (0.25 in all). Recipes take whole units — fix it in Food › Recipes, then settle." });
    assert.equal(await prisma.sale.count(), sales);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "SENT");
  });

  test("a split bill: the first part makes the Sale and moves the stock; later parts add payments; the last closes it", async () => {
    const orderId = await billedOrder();
    assert.ok((await splitOrderBill(orderId, await versionOf(orderId), { mode: "EQUAL", ways: 3 })).ok);
    const parts = await prisma.orderBillPart.findMany({ where: { orderId, deletedAt: null }, orderBy: { number: "asc" } });
    const before = await stocks();

    const third = ok(await settle(orderId, { partId: parts[2].id, payments: [pay("CASH", "20")] }));
    assert.deepEqual([third.closed, third.paid, third.change], [false, "17.13", "2.87"]);
    let order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.deepEqual([order.status, order.saleId, order.closedAt], ["SENT", third.saleId, null], "still open, its sale made");
    let sale = await saleOf(third.saleId);
    assert.deepEqual([sale.grandTotal, sale.paid, sale.due, sale.paymentStatus, sale.items.length], ["51.35", "17.13", "34.22", "PARTIAL", 2]);
    const afterFirst = await stocks();
    assert.deepEqual([before.rice! - afterFirst.rice!, before.chicken! - afterFirst.chicken!, before.chapman! - afterFirst.chapman!], [500, 2, 1], "the whole order's stock, once");

    // Now the bill is fixed.
    assert.deepEqual(await addLine({ orderId, version: await versionOf(orderId), productId: id.chapman, modifierIds: [], note: null }), { ok: false, error: PART_PAID });

    const first = ok(await settle(orderId, { partId: parts[0].id, payments: [pay("CARD", "10"), pay("CASH", "10")] }));
    assert.deepEqual([first.closed, first.paid, first.change, first.saleId, first.reference], [false, "17.11", "2.89", third.saleId, third.reference]);
    sale = await saleOf(third.saleId);
    assert.deepEqual([sale.paid, sale.due, sale.paymentStatus], ["34.24", "17.11", "PARTIAL"]);

    const second = ok(await settle(orderId, { partId: parts[1].id, payments: [pay("BANK_TRANSFER", "17.11")] }));
    assert.equal(second.closed, true);
    order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.deepEqual([order.status, !!order.closedAt, order.activeTableId], ["BILLED", true, null]);
    sale = await saleOf(third.saleId);
    assert.deepEqual([sale.paid, sale.due, sale.paymentStatus], ["51.35", "0.00", "PAID"]);
    const ref = "ORD-" + String(order.number).padStart(4, "0");
    assert.deepEqual(sale.payments, [
      // The first payment goes in with the sale (retail's createSale takes it without notes; the sale's notes name the order).
      ["CASH", "17.13", null],
      ["CARD", "10.00", `Restaurant ${ref} · 1 of 3`],
      ["CASH", "7.11", `Restaurant ${ref} · 1 of 3`],
      ["BANK_TRANSFER", "17.11", `Restaurant ${ref} · 2 of 3`],
    ]);
    assert.deepEqual(await stocks(), afterFirst, "no more stock moved");
    assert.deepEqual((await prisma.orderBillPart.findMany({ where: { orderId, deletedAt: null }, orderBy: { number: "asc" } })).map((p) => p.status), ["PAID", "PAID", "PAID"]);
    assert.equal(await prisma.orderSettlement.count({ where: { orderId } }), 3);
    assert.equal(await prisma.sale.count({ where: { id: third.saleId } }), 1);
  });

  test("several methods on the whole bill; a tip for the waiter, kept out of the sale", async () => {
    const orderId = await billedOrder();
    assert.ok((await changeOrderDetails(orderId, await versionOf(orderId), { field: "waiterId", value: userId })).ok);
    const result = ok(await settle(orderId, { tip: "5", payments: [pay("CARD", "25"), pay("CASH", "40")] }));
    // Bill 51.35 + tip 5 = 56.35; card 25, cash 40 → 8.65 change, so the cash keeps 31.35 — and the
    // tip comes from the last method (the cash): the sale gets card 25 + cash 26.35.
    assert.equal(result.change, "8.65");
    const sale = await saleOf(result.saleId);
    assert.deepEqual([sale.grandTotal, sale.paid, sale.paymentStatus, sale.payments], ["51.35", "51.35", "PAID", [["CARD", "25.00", null], ["CASH", "26.35", `Restaurant ORD-${String((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).number).padStart(4, "0")}`]]]);
    const tips = await prisma.orderTip.findMany({ where: { orderId } });
    assert.deepEqual(tips.map((t) => [t.waiterId === userId, t.paymentType, t.amount.toFixed(2)]), [[true, "CASH", "5.00"]]);
    assert.equal((await prisma.orderSettlement.findFirstOrThrow({ where: { orderId } })).tip.toFixed(2), "5.00");
    assert.deepEqual((await getReceiptExtras(result.saleId))?.tips, [[`Tip · ${waiterName}`, formatNaira("5.00")]]);
  });

  test("a waiter adding a line while the bill is settled: it comes first (settle refused) or after (refused) — never lost", async () => {
    for (let round = 0; round < 8; round++) {
      const orderId = await billedOrder();
      const version = await versionOf(orderId);
      const [settled, added] = await Promise.all([
        settleOrder({ orderId, version, payments: [pay("CASH", "60")], tip: "0", idempotencyKey: randomUUID() }, userId),
        addLine({ orderId, version, productId: id.chapman, modifierIds: [], note: null }),
      ]);
      assert.equal([settled.ok, added.ok].filter(Boolean).length, 1, `round ${round}: exactly one goes ahead — ${JSON.stringify([settled, added])}`);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { where: { deletedAt: null } } } });
      if (added.ok) {
        assert.deepEqual([order.status, order.items.length, order.saleId], ["SENT", 3, null], "the line is on the still-open order");
      } else {
        assert.deepEqual([order.status, order.items.length], ["BILLED", 2], "the bill was settled without it, and the waiter was told");
        assert.ok(!added.ok && (added.error === STALE || added.error === ORDER_CLOSED));
      }
    }
  });
});
