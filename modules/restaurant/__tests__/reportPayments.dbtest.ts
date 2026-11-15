// Restaurant Reports, Step 6, against a real database (a throwaway copy):
// a split bill paid part by card and part by cash, a bill with a card tip,
// two refunds (one back to stock) — then Payments & tips: each method's
// payments (each part by its own method, exactly what was due: no change,
// no tips), tips by waiter and by method, and the refunds list. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportPayments.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { splitOrderBill } from "../server/services/bill";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { methodLines, refundTotals, tipLines } from "../lib/reportPayments";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getPaymentsReport } from "../server/queries/reports/payments";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const at = (iso: string) => new Date(iso);
const DAY = "2025-08-05";
let userId = "";
let areaId = "";
let dish = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function sent(plates: number) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RP${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  for (let i = 0; i < plates; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: i ? `plate ${i + 1}` : null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), userId)).ok);
  return opened.orderId;
}
const settle = async (orderId: string, input: { partId?: string; payments: { paymentType: "CASH" | "CARD" | "BANK_TRANSFER" | "CHEQUE"; amount: string }[]; tip?: string }) => {
  const done = await settleOrder({ orderId, version: await versionOf(orderId), partId: input.partId, payments: input.payments, tip: input.tip ?? "0", idempotencyKey: randomUUID() }, userId);
  assert.ok(done.ok, JSON.stringify(done));
};
const closeAt = (orderId: string, iso: string) => prisma.order.update({ where: { id: orderId }, data: { closedAt: at(iso) } });

describe("Reports payments & tips (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Pelumi", lastName: "Payments", email: `pelumi-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Payments check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Payments check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "RP Rice", code: `RP-${Date.now()}`, price: "20.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 100 } });

    // ₦40 split in two: ₦20 by card, ₦20 in cash (₦50 handed over: ₦30 change).
    const split = await sent(2);
    assert.ok((await splitOrderBill(split, await versionOf(split), { mode: "EQUAL", ways: 2 })).ok);
    const parts = await prisma.orderBillPart.findMany({ where: { orderId: split, deletedAt: null }, orderBy: { number: "asc" }, select: { id: true } });
    await settle(split, { partId: parts[0].id, payments: [{ paymentType: "CARD", amount: "20" }] });
    await settle(split, { partId: parts[1].id, payments: [{ paymentType: "CASH", amount: "50" }] });
    await closeAt(split, "2025-08-05T12:00:00Z");
    // ₦60 by card with a ₦6 card tip.
    const tipped = await sent(3);
    await settle(tipped, { payments: [{ paymentType: "CARD", amount: "66" }], tip: "6" });
    await closeAt(tipped, "2025-08-05T19:00:00Z");
    // Refunds that evening: one plate of each — the split one back to stock.
    for (const [orderId, toStock] of [[split, true], [tipped, false]] as const) {
      const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { saleId: true } })).saleId!;
      const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId }, select: { id: true } });
      const refunded = await refundOrder({ orderId, lines: [{ saleItemId: line.id, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: toStock, idempotencyKey: randomUUID() }, userId);
      assert.ok(refunded.ok, JSON.stringify(refunded));
      await prisma.saleReturn.updateMany({ where: { saleId }, data: { createdAt: at(orderId === split ? "2025-08-05T20:00:00Z" : "2025-08-05T21:00:00Z") } });
    }
  });
  after(() => prisma.$disconnect());

  const mine = (): ReportFilters => ({ area: null, waiter: userId, type: null, station: null, device: null });
  const report = async () => {
    const result = await getPaymentsReport(parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window, mine());
    assert.ok(result.ok);
    return result.data;
  };

  test("by method: each part of the split by its own method; exactly what was due (no change, no tips)", async () => {
    const { lines, totals } = methodLines((await report()).methods);
    const by = Object.fromEntries(lines.map((l) => [l.method, l]));
    assert.deepEqual([by.CARD.count, by.CARD.amount, by.CASH.count, by.CASH.amount, by.BANK_TRANSFER.count], [2, "80.00", 1, "20.00", 0]);
    assert.deepEqual([totals.count, totals.amount, by.CARD.share], [3, "100.00", 80]);
    const sales = await prisma.sale.findMany({ where: { order: { waiterId: userId } }, select: { grandTotal: true } });
    assert.equal(sales.reduce((t, s) => t + Number(s.grandTotal), 0).toFixed(2), totals.amount, "the bills' totals");
  });

  test("tips by waiter and by method", async () => {
    const data = await report();
    const tips = tipLines(data.tipsByWaiter, data.names);
    assert.deepEqual(tips.lines.map((l) => [l.userId, l.count, l.amount]), [[userId, 1, "6.00"]]);
    assert.deepEqual(methodLines(data.tipsByMethod).lines.filter((l) => l.count).map((l) => [l.method, l.amount]), [["CARD", "6.00"]]);
  });

  test("refunds: newest first, with the sale, order, method, who and whether stock went back", async () => {
    const data = await report();
    assert.deepEqual(data.refunds.map((r) => [r.amount.toString(), r.methods, r.toStock]), [["20", ["CASH"], false], ["20", ["CASH"], true]]);
    // Each with its bill's own Sale and order.
    const bills = await prisma.order.findMany({ where: { waiterId: userId }, select: { number: true, sale: { select: { reference: true } } } });
    const saleOf = new Map(bills.map((b) => [b.number, b.sale?.reference]));
    assert.deepEqual(data.refunds.map((r) => [r.by, r.sale === saleOf.get(r.orderNumber)]), [["Pelumi Payments", true], ["Pelumi Payments", true]]);
    assert.deepEqual(refundTotals(data.refunds), { count: 2, amount: "40.00", toStock: 1 });
    assert.equal(data.refundsCut, false);
  });
});
