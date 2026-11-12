// Part 6f Step 7b against a real database (a throwaway copy): a till opened
// with a float (once), cash taken on it while open — a restaurant bill with a
// cash tip, a refund, a counter POS sale — counted toward it; elsewhere not.
// Closed with the cash counted: expected, counted and the variance kept, the
// Z-report through the print queue, each step logged. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/till.dbtest.ts
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
import { refundOrder } from "../server/services/refund";
import { getRefundView } from "../server/queries/refund";
import { closeTill, getTillScreen, openTill, printZReport, tillSessionIdFor } from "../server/services/till";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let dish = "";
let session = "";
let n = 0;
const till = randomUUID();
const other = randomUUID();
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

// 2× ₦25 dishes, sent: ₦50 (no service charge, no tax).
async function billedOrder() {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`TL${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  for (let i = 0; i < 2; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  return opened.orderId;
}

describe("Cash-up (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Till check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Till check" }, select: { id: true } })).id;
    const product = await prisma.product.create({ data: { name: "TL Suya", code: `TL-${Date.now()}`, price: "25.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } });
    await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
    dish = product.id;
    await prisma.device.createMany({ data: [{ id: till, name: "Till check" }, { id: other, name: "Other check" }] });
    // This copy's receipt printers (another suite may have set one up) out of the way.
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
  });
  after(() => prisma.$disconnect());

  test("open with a float (logged); a second open is refused; nothing open elsewhere", async () => {
    const opened = await openTill({ deviceId: till, float: new Decimal("10000") }, userId);
    assert.ok(opened.ok, JSON.stringify(opened));
    session = opened.ok ? opened.id : "";
    assert.deepEqual(await openTill({ deviceId: till, float: new Decimal("1") }, userId), { ok: false, error: "This till is open already — refreshed." });
    assert.equal(await tillSessionIdFor(till), session);
    assert.equal(await tillSessionIdFor(other), null);
    assert.equal(await tillSessionIdFor(null), null);
    assert.equal(await prisma.auditLog.count({ where: { action: "till.open", entityId: session } }), 1);
  });

  test("a bill paid in cash on the till (with a cash tip) counts toward it; one paid on another device doesn't", async () => {
    const here = await billedOrder();
    const paid = await settleOrder({ orderId: here, version: await versionOf(here), payments: [{ paymentType: "CASH", amount: "70" }], tip: "5", idempotencyKey: randomUUID() }, userId, { deviceId: till });
    assert.ok(paid.ok, JSON.stringify(paid));
    const elsewhere = await billedOrder();
    assert.ok((await settleOrder({ orderId: elsewhere, version: await versionOf(elsewhere), payments: [{ paymentType: "CARD", amount: "50" }], tip: "0", idempotencyKey: randomUUID() }, userId, { deviceId: other })).ok);
    const linked = await prisma.salePayment.findMany({ where: { tillSessionId: session }, select: { amount: true, paymentType: true } });
    assert.deepEqual(linked.map((p) => [p.paymentType, p.amount.toFixed(2)]), [["CASH", "50.00"]], "net of the ₦15 change and the ₦5 tip");
    assert.deepEqual((await prisma.orderTip.findMany({ where: { tillSessionId: session }, select: { amount: true, paymentType: true } })).map((t) => [t.paymentType, t.amount.toFixed(2)]), [["CASH", "5.00"]]);

    const view = await getRefundView(here);
    assert.ok(view);
    const refunded = await refundOrder(
      { orderId: here, lines: [{ saleItemId: view!.lines[0].saleItemId, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: false, idempotencyKey: randomUUID() },
      userId,
      { deviceId: till },
    );
    assert.ok(refunded.ok, JSON.stringify(refunded));
    assert.equal((await prisma.saleReturnPayment.findMany({ where: { tillSessionId: session } })).length, 1, "the cash refund comes out of this till");
  });

  test("what should be in the drawer: float + cash taken + cash tips − cash refunds; takings by method", async () => {
    const screen = await getTillScreen(till);
    assert.ok(screen.open);
    const f = screen.open!.figures;
    assert.deepEqual([f.float, f.cashSales, f.cashTips, f.cashRefunds], ["10000.00", "50.00", "5.00", "25.00"]);
    assert.equal(f.expected, "10030.00");
    assert.deepEqual(f.byMethod.find((m) => m.method === "CASH"), { method: "CASH", label: "Cash", amount: "50.00", count: 1 });
    assert.equal(screen.printer, null, "no receipt printer for this till yet");
  });

  test("close with the cash counted: expected, counted and the variance kept (logged); closing again is refused", async () => {
    const closed = await closeTill({ deviceId: till, sessionId: session, counted: new Decimal("10000"), note: "short — check the float" }, userId);
    assert.ok(closed.ok, JSON.stringify(closed));
    if (!closed.ok) return;
    assert.deepEqual([closed.summary.figures.expected, closed.summary.counted, closed.summary.variance, closed.summary.result], ["10030.00", "10000.00", "-30.00", "Short ₦30.00"]);
    const row = await prisma.tillSession.findUniqueOrThrow({ where: { id: session }, select: { closedAt: true, expected: true, variance: true, cashSales: true } });
    assert.ok(row.closedAt && row.expected?.toFixed(2) === "10030.00" && row.variance?.toFixed(2) === "-30.00");
    assert.deepEqual(await closeTill({ deviceId: till, sessionId: session, counted: new Decimal("1"), note: null }, userId), { ok: false, error: "This till has been closed already — refreshed." });
    assert.equal(await tillSessionIdFor(till), null, "closed: nothing more counts toward it");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "till.close", entityId: session }, select: { meta: true } });
    assert.equal((log.meta as { variance: string }).variance, "-30.00");
    const screen = await getTillScreen(till);
    assert.deepEqual([screen.open, screen.recent[0]?.id, screen.recent[0]?.result], [null, session, "Short ₦30.00"]);
  });

  test("the Z-report: refused with no receipt printer; queued on the till's printer (REPORT, logged); a second print is a reprint", async () => {
    assert.deepEqual(await printZReport({ deviceId: till, sessionId: session }, userId), { ok: false, error: "This till has no receipt printer. Set one up in Settings › Printers." });
    const printer = await prisma.printer.create({ data: { name: "Till check printer", connection: "NETWORK", address: "127.0.0.1:9" }, select: { id: true } });
    await prisma.deviceOverride.create({ data: { deviceId: till, role: "RECEIPT", printerId: printer.id } });
    const first = await printZReport({ deviceId: till, sessionId: session }, userId);
    assert.deepEqual(first, { ok: true, printer: "Till check printer", reprint: false });
    const job = await prisma.printJob.findFirstOrThrow({ where: { refId: session }, select: { type: true, template: true, data: true } });
    assert.deepEqual([job.type, job.template], ["REPORT", "ZREPORT"]);
    assert.equal((job.data as { result: string }).result, "Short ₦30.00");
    assert.deepEqual(await printZReport({ deviceId: till, sessionId: session }, userId), { ok: true, printer: "Till check printer", reprint: true });
    assert.equal(await prisma.auditLog.count({ where: { action: "till.z.print", entityId: session } }), 2);
    assert.deepEqual(await printZReport({ deviceId: other, sessionId: session }, userId), { ok: false, error: "That cash-up isn't on this till." });
    await prisma.printJob.deleteMany({ where: { printerId: printer.id } });
    await prisma.deviceOverride.deleteMany({ where: { printerId: printer.id } });
    await prisma.printer.delete({ where: { id: printer.id } });
  });
});
