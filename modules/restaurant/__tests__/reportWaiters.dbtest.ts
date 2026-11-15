// Restaurant Reports, Step 4, against a real database (a throwaway copy):
// two waiters' bills settled the real way — a tip, a discount a manager put
// on, a refund, a void a manager's PIN approved, a clocked shift — then By
// waiter: each person's figures, table time, hours and sales per hour, the
// discount and the override credited to the right people, and the waiter
// filter. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportWaiters.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, sendToKitchen } from "../server/services/orderFlow";
import { applyOrderDiscount } from "../server/services/bill";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { setApprovalPin } from "../server/services/approvalPins";
import { endShift, startShift } from "../server/services/shifts";
import { waiterLines } from "../lib/reportWaiters";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getWaiterReport } from "../server/queries/reports/waiters";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// 10 June 2025 in Lagos (in the past: shifts count up to now).
const at = (iso: string) => new Date(iso);
const DAY = "2025-06-10";
const user: Record<"ada" | "tayo" | "mona", string> = { ada: "", tayo: "", mona: "" };
let areaId = "";
let dish = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

// Each plate its own line (a note keeps the same dish from adding onto one line).
async function order(waiterId: string, plates: number) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RW${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, waiterId);
  assert.ok(opened.ok);
  for (let i = 0; i < plates; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: i === 0 ? null : `plate ${i + 1}` })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), waiterId)).ok);
  return opened.orderId;
}
async function settle(orderId: string, waiterId: string, { openedAt, closedAt, tip = "0" }: { openedAt: Date; closedAt: Date; tip?: string }) {
  const done = await settleOrder({ orderId, version: await versionOf(orderId), payments: [{ paymentType: "CASH", amount: "200" }], tip, idempotencyKey: randomUUID() }, waiterId);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: orderId }, data: { openedAt, closedAt } });
}

const mine = (f: Partial<ReportFilters> = {}): ReportFilters => ({ area: null, waiter: null, type: null, station: null, device: null, ...f });
async function report(f: Partial<ReportFilters> = {}) {
  const result = await getWaiterReport(parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window, mine(f));
  assert.ok(result.ok);
  // Only this file's people (the copy has the business's own too).
  const { lines } = waiterLines(result.data);
  return Object.fromEntries(lines.filter((l) => l.userId && Object.values(user).includes(l.userId)).map((l) => [Object.entries(user).find(([, id]) => id === l.userId)![0], l]));
}

describe("Reports by waiter (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const stamp = Date.now();
    const role = async (name: string, permissions: string[]) => (await prisma.role.create({ data: { name: `${name} ${stamp}`, permissions: { create: permissions.map((permission) => ({ permission })) } }, select: { id: true } })).id;
    const waiterRole = await role("RW waiter", [P.MANAGE_ORDERS]);
    const make = async (first: string, roleId: string) =>
      (await prisma.user.create({ data: { firstName: first, lastName: "Waiters", email: `${first.toLowerCase()}-${stamp}@check.test`, password: await bcrypt.hash("x", 4), roleId }, select: { id: true } })).id;
    user.ada = await make("Ada", waiterRole);
    user.tayo = await make("Tayo", waiterRole);
    user.mona = await make("Mona", await role("RW manager", [P.MANAGE_ORDERS, P.APPROVE_VOID, P.APPROVE_DISCOUNT]));
    assert.ok((await setApprovalPin(user.mona, "2580")).ok);
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantClockInOut: true }, update: { restaurantServiceChargePercent: 0, restaurantDiscountLimitPercent: 50, restaurantClockInOut: true } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Waiter check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Waiter check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "RW Rice", code: `RW-${stamp}`, price: "20.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 100 } });

    // Ada: ₦40 (40 min at the table, ₦5 tip), ₦60 with 10% off by Mona (1h 20m), one plate of the first refunded.
    const a1 = await order(user.ada, 2);
    await settle(a1, user.ada, { openedAt: at("2025-06-10T11:00:00Z"), closedAt: at("2025-06-10T11:40:00Z"), tip: "5" });
    const a2 = await order(user.ada, 3);
    assert.ok((await applyOrderDiscount({ orderId: a2, version: await versionOf(a2), type: "PERCENT", value: "10", reason: "Birthday" }, user.mona)).ok);
    await settle(a2, user.ada, { openedAt: at("2025-06-10T12:00:00Z"), closedAt: at("2025-06-10T13:20:00Z") });
    const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: a1 }, select: { saleId: true } })).saleId!;
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId }, select: { id: true } });
    assert.ok((await refundOrder({ orderId: a1, lines: [{ saleItemId: line.id, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: false, idempotencyKey: randomUUID() }, user.ada)).ok);
    await prisma.saleReturn.updateMany({ where: { saleId }, data: { createdAt: at("2025-06-10T14:00:00Z") } });

    // Tayo: 2 plates sent, one voided with Mona's PIN; ₦20 settled.
    const t1 = await order(user.tayo, 2);
    const voided = await prisma.orderItem.findFirstOrThrow({ where: { orderId: t1 }, select: { id: true } });
    const cancel = await cancelLine({ orderId: t1, lineId: voided.id, version: await versionOf(t1), reason: "WRONG_ITEM", details: null, managerApproval: { approverId: user.mona, pin: "2580" } }, user.tayo, { mayVoid: false });
    assert.ok(cancel.ok, JSON.stringify(cancel));
    await prisma.orderItem.update({ where: { id: voided.id }, data: { cancelledAt: at("2025-06-10T15:00:00Z") } });
    await prisma.auditLog.updateMany({ where: { entityId: voided.id, action: { startsWith: "override." } }, data: { createdAt: at("2025-06-10T15:00:00Z") } });
    await settle(t1, user.tayo, { openedAt: at("2025-06-10T15:00:00Z"), closedAt: at("2025-06-10T15:30:00Z") });

    // Ada's shift: 08:00–14:00Z.
    assert.ok((await startShift(user.ada, null, at("2025-06-10T08:00:00Z"))).ok);
    assert.ok((await endShift(user.ada, null, at("2025-06-10T14:00:00Z"))).ok);
  });
  after(() => prisma.$disconnect());

  test("each waiter: orders, covers, net sales (less refunds), average bill, tips, table time", async () => {
    const by = await report();
    const refund = await prisma.saleReturn.findFirstOrThrow({ where: { sale: { order: { waiterId: user.ada } } }, select: { grandTotal: true } });
    assert.deepEqual([by.ada.orders, by.ada.net, by.ada.averageBill, by.ada.tips], [2, (94 - Number(refund.grandTotal)).toFixed(2), "47.00", "5.00"], "₦40 + ₦54");
    assert.equal(by.ada.averageTableSeconds, 3600, "(40m + 80m) / 2");
    assert.deepEqual([by.tayo.orders, by.tayo.net, by.tayo.averageTableSeconds], [1, "20.00", 1800]);
  });

  test("discounts to whoever applied them; voids and overrides to whoever needed them", async () => {
    const by = await report();
    assert.deepEqual([by.mona.discounts, by.mona.discountAmount, by.mona.orders], [1, "6.00", 0]);
    assert.deepEqual([by.ada.discounts, by.tayo.voids, by.tayo.voidValue, by.tayo.overrides], [0, 1, "20.00", 1]);
    assert.equal(by.mona.overrides, 0, "the approval isn't counted as hers");
  });

  test("hours on shift and sales per hour", async () => {
    const by = await report();
    assert.equal(by.ada.shiftSeconds, 6 * 3600);
    assert.equal(by.ada.salesPerHour, (Number(by.ada.net) / 6).toFixed(2));
    assert.equal(by.tayo.shiftSeconds, null);
  });

  test("the waiter filter: their orders (and the discount Mona put on one); someone else's voids gone", async () => {
    const only = await report({ waiter: user.ada });
    assert.deepEqual(Object.keys(only).sort(), ["ada", "mona"]);
    assert.equal(only.ada.orders, 2);
    const tayo = await report({ waiter: user.tayo });
    assert.deepEqual([Object.keys(tayo), tayo.tayo.voids, tayo.tayo.overrides], [["tayo"], 1, 1]);
  });
});
