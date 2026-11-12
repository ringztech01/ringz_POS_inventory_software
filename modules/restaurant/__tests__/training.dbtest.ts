// Part 6f Step 7f against a real database (a throwaway copy): training mode.
// Someone in training opens TRAINING orders on the real floor; their kitchen
// tickets aren't on the kitchen display; settling closes the order with no
// sale, payment, settlement or stock movement; a voided line logs no waste;
// the dashboard leaves them out. Each on / off is logged. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/training.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { setTrainingMode } from "../server/services/training";
import { getKitchenBoard } from "../server/queries/kds";
import { getOpenOrders } from "../server/queries/dashboard";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
let admin = "";
let trainee = "";
let areaId = "";
let dish = "";
let warehouseId = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function sentOrder(waiterId: string) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`TR${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, waiterId);
  assert.ok(opened.ok);
  for (let i = 0; i < 2; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), waiterId)).ok);
  return opened.orderId;
}
const stockOf = async () => (await prisma.productStock.findFirstOrThrow({ where: { productId: dish, warehouseId }, select: { quantity: true } })).quantity.toString();

describe("Training mode (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    admin = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    trainee = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, disabledAt: null, id: { not: admin }, userRole: { is: { deletedAt: null } } }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Training check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Training check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "TR Pepper soup", code: `TR-${Date.now()}`, price: "30.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 50 } });
  });
  after(async () => {
    await setTrainingMode({ id: trainee, on: false }, admin);
    await prisma.$disconnect();
  });

  test("on (logged): the trainee's orders are TRAINING; a real waiter's aren't", async () => {
    assert.deepEqual(await setTrainingMode({ id: trainee, on: true }, admin), { ok: true });
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.training.on", entityId: trainee, userId: admin } }), 1);
    const practice = await sentOrder(trainee);
    const real = await sentOrder(admin);
    assert.deepEqual(
      (await prisma.order.findMany({ where: { id: { in: [practice, real] } }, select: { id: true, training: true } })).map((o) => [o.id === practice, o.training]).sort(),
      [[false, false], [true, true]],
    );
  });

  test("the kitchen display and the dashboard leave training orders out", async () => {
    const practice = (await prisma.order.findFirstOrThrow({ where: { training: true, waiterId: trainee }, orderBy: { openedAt: "desc" }, select: { id: true } })).id;
    const board = await getKitchenBoard({ station: null, view: "active" });
    const onBoard = JSON.stringify(board);
    assert.ok(!onBoard.includes(practice), "not on the kitchen display");
    assert.ok((await prisma.kot.count({ where: { orderId: practice } })) > 0, "its tickets still exist (the order screen shows them sent)");
    const open = await getOpenOrders();
    assert.ok(!open.rows.some((r) => r.id === practice), "not among the dashboard's open orders");
  });

  test("settled: closed, with no sale, payment, settlement or stock movement", async () => {
    const practice = await sentOrder(trainee);
    const [sales, settlements, stock] = [await prisma.sale.count(), await prisma.orderSettlement.count(), await stockOf()];
    const paid = await settleOrder({ orderId: practice, version: await versionOf(practice), payments: [{ paymentType: "CASH", amount: "100" }], tip: "5", idempotencyKey: randomUUID() }, trainee);
    assert.ok(paid.ok && paid.training && paid.closed && paid.saleId === "", JSON.stringify(paid));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: practice }, select: { status: true, saleId: true } });
    assert.deepEqual([order.status, order.saleId], ["BILLED", null]);
    assert.deepEqual([await prisma.sale.count(), await prisma.orderSettlement.count(), await stockOf()], [sales, settlements, stock]);
    assert.equal(await prisma.orderTip.count({ where: { orderId: practice } }), 0);
  });

  test("a voided line on a training order logs no waste", async () => {
    const practice = await sentOrder(trainee);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: practice, deletedAt: null }, select: { id: true } });
    await prisma.orderItem.update({ where: { id: line.id }, data: { kitchenStatus: "SERVED" } });
    const before = await prisma.wasteEntry.count();
    const voided = await cancelLine({ orderId: practice, version: await versionOf(practice), lineId: line.id, reason: "RETURNED_BY_GUEST", details: "Cold", wasted: true }, trainee);
    assert.ok(voided.ok, JSON.stringify(voided));
    assert.equal(await prisma.wasteEntry.count(), before);
  });

  test("off (logged): their next order is real", async () => {
    await setTrainingMode({ id: trainee, on: false }, admin);
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.training.off", entityId: trainee } }), 1);
    const real = await sentOrder(trainee);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: real }, select: { training: true } })).training, false);
  });
});
