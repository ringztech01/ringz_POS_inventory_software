// Restaurant Reports, Step 8, against a real database (a throwaway copy):
// voids and discounts made the real way — a void a manager's PIN approved, a
// void by someone allowed to, a discount within the limit and one over it
// approved with a PIN — then Voids & discounts: each row, who approved it
// (the Part 6f override), the totals, and the filters. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportVoids.dbtest.ts
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
import { setApprovalPin } from "../server/services/approvalPins";
import { discountShare, overLimit, voidReason } from "../lib/reportVoids";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getVoidsReport } from "../server/queries/reports/voids";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const DAY = "2025-10-14";
const at = (hhmm: string) => new Date(`2025-10-14T${hhmm}:00.000Z`);
const user: Record<"ada" | "mona", string> = { ada: "", mona: "" };
let areaId = "";
let dish = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function sentOrder(plates: number) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RV${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, user.ada);
  assert.ok(opened.ok);
  for (let i = 0; i < plates; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: i ? `plate ${i + 1}` : null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), user.ada)).ok);
  return opened.orderId;
}
async function settleAt(orderId: string, when: string) {
  const done = await settleOrder({ orderId, version: await versionOf(orderId), payments: [{ paymentType: "CASH", amount: "200" }], tip: "0", idempotencyKey: randomUUID() }, user.ada);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: orderId }, data: { closedAt: at(when) } });
}

describe("Reports voids & discounts (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const stamp = Date.now();
    const role = async (name: string, permissions: string[]) => (await prisma.role.create({ data: { name: `${name} ${stamp}`, permissions: { create: permissions.map((permission) => ({ permission })) } }, select: { id: true } })).id;
    const make = async (first: string, roleId: string) =>
      (await prisma.user.create({ data: { firstName: first, lastName: "Voids", email: `${first.toLowerCase()}-${stamp}@check.test`, password: await bcrypt.hash("x", 4), roleId }, select: { id: true } })).id;
    user.ada = await make("Ada", await role("RV waiter", [P.MANAGE_ORDERS]));
    user.mona = await make("Mona", await role("RV manager", [P.MANAGE_ORDERS, P.APPROVE_VOID, P.APPROVE_DISCOUNT]));
    assert.ok((await setApprovalPin(user.mona, "2580")).ok);
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0, restaurantDiscountLimitPercent: 10 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Voids check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Voids check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "RV Soup", code: `RV-${stamp}`, price: "25.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 100 } });

    // An open order: one plate voided by Ada with Mona's PIN, one by Mona herself.
    const open = await sentOrder(3);
    const lines = await prisma.orderItem.findMany({ where: { orderId: open }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const pinned = await cancelLine({ orderId: open, lineId: lines[0].id, version: await versionOf(open), reason: "WRONG_ITEM", details: null, managerApproval: { approverId: user.mona, pin: "2580" } }, user.ada, { mayVoid: false });
    assert.ok(pinned.ok, JSON.stringify(pinned));
    assert.ok((await cancelLine({ orderId: open, lineId: lines[1].id, version: await versionOf(open), reason: "WRONG_ITEM", details: null }, user.mona, { mayVoid: true })).ok);
    await prisma.orderItem.update({ where: { id: lines[0].id }, data: { cancelledAt: at("12:00") } });
    await prisma.orderItem.update({ where: { id: lines[1].id }, data: { cancelledAt: at("12:30") } });

    // ₦100 bills: 5% off by Ada (within the 10% limit); 20% off with Mona's PIN.
    const small = await sentOrder(4);
    assert.ok((await applyOrderDiscount({ orderId: small, version: await versionOf(small), type: "PERCENT", value: "5", reason: "Regular" }, user.ada)).ok);
    await settleAt(small, "13:00");
    const big = await sentOrder(4);
    const asked = await applyOrderDiscount({ orderId: big, version: await versionOf(big), type: "PERCENT", value: "20", reason: "Birthday", approval: { approverId: user.mona, pin: "2580" } }, user.ada);
    assert.ok(asked.ok, JSON.stringify(asked));
    await settleAt(big, "14:00");
  });
  after(() => prisma.$disconnect());

  const report = async (f: Partial<ReportFilters> = {}) => {
    const result = await getVoidsReport(parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window, { area: null, waiter: user.ada, type: null, station: null, device: null, ...f });
    assert.ok(result.ok);
    return result.data;
  };

  test("voids: newest first; who voided, why, and who approved (a manager's PIN)", async () => {
    const data = await report();
    assert.deepEqual(
      data.voids.map((v) => [v.quantity, v.value.toString(), v.waiter, v.voidedBy, voidReason(v.reason), v.approvedBy]),
      [
        [1, "25", "Ada Voids", "Mona Voids", "Wrong item", null],
        [1, "25", "Ada Voids", "Ada Voids", "Wrong item", "Mona Voids"],
      ],
    );
    assert.deepEqual([data.totals.voids.count, data.totals.voids.value.toFixed(2), data.totals.voids.approved], [2, "50.00", 1]);
  });

  test("discounts: what was asked, what the bill took off, who applied and approved; over the limit", async () => {
    const data = await report();
    const rows = data.discounts.map((d) => [d.value.toString(), d.amount.toString(), discountShare(d.amount, d.items), overLimit(discountShare(d.amount, d.items), data.limitPercent), d.reason, d.appliedBy, d.approvedBy]);
    assert.deepEqual(rows, [
      ["20", "20", 20, true, "Birthday", "Ada Voids", "Mona Voids"],
      ["5", "5", 5, false, "Regular", "Ada Voids", null],
    ]);
    assert.deepEqual([data.totals.discounts.count, data.totals.discounts.amount.toFixed(2), data.totals.discounts.approved, data.limitPercent.toString()], [2, "25.00", 1, "10"]);
  });

  test("the filters: another waiter's orders have none; a type with none", async () => {
    const other = await report({ waiter: user.mona });
    assert.deepEqual([other.voids.length, other.discounts.length], [0, 0]);
    const tabs = await report({ type: "BAR_TAB" });
    assert.deepEqual([tabs.totals.voids.count, tabs.totals.discounts.count], [0, 0]);
  });
});
