// Discounts, the approver PIN, the service charge switch and "Bill changed
// since print" against a real database (services/bill.ts,
// services/approvalPins.ts). Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/discount.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/format";
import { newQrToken } from "../lib/qrToken";
import type { OrderDiscountInput } from "../schemas/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine, setLineQuantity } from "../server/services/orderLines";
import { cancelLine, markLineServed, sendToKitchen } from "../server/services/orderFlow";
import { changeOrderDetails, STALE } from "../server/services/orders";
import { advanceLine } from "../server/services/kitchen";
import { moveOrder } from "../server/services/tableMoves";
import { getBill } from "../server/queries/bill";
import { getDiscountApprovers } from "../server/queries/approvers";
import { getOrderScreen } from "../server/queries/orderScreen";
import { applyOrderDiscount, registerBillPrint, setOrderServiceCharge } from "../server/services/bill";
import { checkApproverPin, PIN_TRIES, setApprovalPin, WRONG_PIN } from "../server/services/approvalPins";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let adminId = "";
let waiterId = "";
let areaId = "";
let tableCount = 0;
const dish: Record<"jollof" | "chapman", string> = { jollof: "", chapman: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
const printState = (orderId: string) => prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { billPrintedAt: true, billChangedAt: true } });
async function newTable() {
  tableCount += 1;
  return (await prisma.table.create({ data: { name: `D${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } })).id;
}
async function newOrder() {
  const opened = await openTableOrder(await newTable(), adminId);
  assert.ok(opened.ok);
  return opened.orderId;
}
async function tap(orderId: string, productId: string) {
  const result = await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null });
  assert.ok(result.ok, JSON.stringify(result));
}
async function send(orderId: string) {
  assert.ok((await sendToKitchen(orderId, await versionOf(orderId), adminId)).ok);
}
// 2× Jollof ₦18 + 1× Chapman ₦10 (7.5% tax), all sent: sub total ₦46.00.
async function billedOrder() {
  const orderId = await newOrder();
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.chapman);
  await send(orderId);
  return orderId;
}
const discount = async (orderId: string, input: Partial<OrderDiscountInput>, userId = waiterId) =>
  applyOrderDiscount({ orderId, version: await versionOf(orderId), type: "PERCENT", value: "10", reason: "Regular guest", ...input }, userId);
const discountRow = (orderId: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { discountType: true, discountValue: true, discountReason: true, discountById: true, discountApprovedById: true, version: true },
  });

describe("Discounts and service charge (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    // A waiter: Manage Orders, but not Approve Discount.
    const role = await prisma.role.create({ data: { name: "chk Discount waiter", permissions: { create: [{ permission: "Manage Orders" }] } }, select: { id: true } });
    waiterId = (
      await prisma.user.create({
        data: { firstName: "Chk", lastName: "Waiter", email: `chk-discount-${Date.now()}@example.test`, password: "x", roleId: role.id },
        select: { id: true },
      })
    ).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantDiscountLimitPercent: 10, restaurantServiceChargePercent: 10 } });

    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Discount check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Discount check" }, select: { id: true } })).id;
    const stationId = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    const make = async (name: string, price: string, orderTax: string) => {
      const product = await prisma.product.create({
        data: { name, code: `DC-${name}-${Date.now()}`, price, orderTax, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.jollof = await make("DC Jollof", "18.00", "0");
    dish.chapman = await make("DC Chapman", "10.00", "7.5");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("up to the limit: applied by the waiter, no approver; the bill's totals follow", async () => {
    const orderId = await billedOrder();
    const before = await versionOf(orderId);
    assert.deepEqual(await discount(orderId, {}), { ok: true, version: before + 1 });
    const row = await discountRow(orderId);
    assert.deepEqual([row.discountType, row.discountValue.toFixed(2), row.discountReason, row.discountById, row.discountApprovedById], ["PERCENT", "10.00", "Regular guest", waiterId, null]);

    const bill = await getBill(orderId);
    assert.ok(bill);
    // 46 − 4.60 = 41.40; service 4.14; + tax 0.75 = 46.29.
    assert.deepEqual(
      [bill.totals.subTotal, bill.totals.discount, bill.totals.serviceCharge, bill.totals.tax, bill.totals.total],
      [formatNaira("46.00"), formatNaira("4.60"), formatNaira("4.14"), formatNaira("0.75"), formatNaira("46.29")],
    );
    assert.deepEqual(bill.discount, { type: "PERCENT", value: "10", label: "10%", reason: "Regular guest", by: "Chk", approvedBy: null });
    assert.equal(bill.discountLimit, "10%");
    // The ticket and the bill agree when every line is billed.
    const screen = await getOrderScreen(orderId);
    assert.equal(screen?.totals.total, bill.totals.total);
    assert.deepEqual(screen?.totals.discount, { label: "10%", amount: `−${formatNaira("4.60")}` });

    // An amount: ₦4.60 of ₦46 is exactly the limit.
    assert.ok((await discount(orderId, { type: "AMOUNT", value: "4.60" })).ok);
    assert.equal((await getBill(orderId))?.totals.total, formatNaira("46.29"));
  });

  test("above the limit: refused until an approver's PIN comes with it; nothing changes meanwhile", async () => {
    const orderId = await billedOrder();
    const before = await discountRow(orderId);
    const asked = await discount(orderId, { value: "15" });
    assert.deepEqual(asked, { ok: false, error: "A discount over 10% needs an approver's PIN.", needsApproval: true, limit: "10%" });
    assert.deepEqual(await discountRow(orderId), before);

    // The waiter can't approve; the admin has no PIN yet.
    assert.equal((await discount(orderId, { value: "15", approval: { approverId: waiterId, pin: "1234" } })).ok, false);
    assert.deepEqual(await setApprovalPin(waiterId, "1234"), { ok: false, error: "Only someone who can approve discounts or waste sets an approval PIN." });
    assert.equal(await prisma.approvalPin.count({ where: { userId: waiterId } }), 0);
    await prisma.approvalPin.deleteMany({ where: { userId: adminId } });
    const noPin = await discount(orderId, { value: "15", approval: { approverId: adminId, pin: "4821" } });
    assert.ok(!noPin.ok && noPin.error.includes("hasn't set an approval PIN"));
    assert.ok(!(await getDiscountApprovers()).some((a) => a.id === adminId), "no PIN, not listed");

    assert.deepEqual(await setApprovalPin(adminId, "4821"), { ok: true });
    const saved = await prisma.approvalPin.findUniqueOrThrow({ where: { userId: adminId } });
    assert.notEqual(saved.pinHash, "4821", "only the hash is kept");
    assert.ok((await getDiscountApprovers()).some((a) => a.id === adminId));

    const wrong = await discount(orderId, { value: "15", approval: { approverId: adminId, pin: "0000" } });
    assert.deepEqual(wrong, { ok: false, error: WRONG_PIN });
    assert.equal((await prisma.approvalPin.findUniqueOrThrow({ where: { userId: adminId } })).failedAttempts, 1, "the wrong try is kept");
    assert.deepEqual(await discountRow(orderId), before);

    const approved = await discount(orderId, { value: "15", approval: { approverId: adminId, pin: "4821" } });
    assert.ok(approved.ok);
    const row = await discountRow(orderId);
    assert.deepEqual([row.discountValue.toFixed(2), row.discountById, row.discountApprovedById], ["15.00", waiterId, adminId]);
    assert.equal((await prisma.approvalPin.findUniqueOrThrow({ where: { userId: adminId } })).failedAttempts, 0, "a right PIN resets the count");
    assert.equal((await getBill(orderId))?.discount?.approvedBy !== null, true);

    // An amount over the limit needs approval too (₦5 of ₦46 ≈ 10.9%).
    const amount = await discount(orderId, { type: "AMOUNT", value: "5" });
    assert.ok(!amount.ok && "needsApproval" in amount);
  });

  test(`${PIN_TRIES} wrong PINs lock it; a lock that has run out lets the right PIN in`, async () => {
    await setApprovalPin(adminId, "4821");
    const orderId = await billedOrder();
    for (let i = 1; i < PIN_TRIES; i++) assert.deepEqual(await discount(orderId, { value: "20", approval: { approverId: adminId, pin: "1111" } }), { ok: false, error: WRONG_PIN });
    const locking = await discount(orderId, { value: "20", approval: { approverId: adminId, pin: "1111" } });
    assert.ok(!locking.ok && locking.error.includes("locked for 5 minutes"));
    const locked = await prisma.approvalPin.findUniqueOrThrow({ where: { userId: adminId } });
    assert.ok(locked.lockedUntil && locked.lockedUntil > new Date());

    const whileLocked = await discount(orderId, { value: "20", approval: { approverId: adminId, pin: "4821" } });
    assert.ok(!whileLocked.ok && whileLocked.error.startsWith("Too many wrong PINs"), "even the right PIN waits");
    assert.equal((await discountRow(orderId)).discountType, null);

    await prisma.approvalPin.update({ where: { userId: adminId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.ok((await discount(orderId, { value: "20", approval: { approverId: adminId, pin: "4821" } })).ok);
    // Setting a new PIN clears any lock.
    await prisma.approvalPin.update({ where: { userId: adminId }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    await setApprovalPin(adminId, "4821");
    const reset = await prisma.approvalPin.findUniqueOrThrow({ where: { userId: adminId } });
    assert.deepEqual([reset.failedAttempts, reset.lockedUntil], [0, null]);
    // The check on its own, in a transaction.
    assert.deepEqual(await prisma.$transaction((tx) => checkApproverPin(tx, adminId, "4821")), { ok: true });
  });

  test("amount rules, removing, and the version check", async () => {
    const orderId = await billedOrder();
    const tooMuch = await discount(orderId, { type: "AMOUNT", value: "46.01" });
    assert.ok(!tooMuch.ok && tooMuch.error.includes(formatNaira("46.00")));
    const empty = await newOrder();
    await tap(empty, dish.jollof);
    const unsentOnly = await discount(empty, { type: "AMOUNT", value: "1" });
    assert.ok(!unsentOnly.ok && unsentOnly.error.startsWith("Nothing is billed yet"), "unsent lines aren't on the bill");

    assert.ok((await discount(orderId, { value: "5" })).ok);
    assert.ok((await discount(orderId, { value: "0", reason: "" })).ok);
    const cleared = await discountRow(orderId);
    assert.deepEqual([cleared.discountType, cleared.discountValue.toFixed(2), cleared.discountReason, cleared.discountById, cleared.discountApprovedById], [null, "0.00", null, null, null]);
    assert.equal((await getBill(orderId))?.discount, null);

    const stale = await applyOrderDiscount({ orderId, version: (await versionOf(orderId)) - 1, type: "PERCENT", value: "5", reason: "x" }, waiterId);
    assert.deepEqual(stale, { ok: false, error: STALE, stale: true });
    // Two devices, same version: one discount wins, the other is told to refresh.
    const version = await versionOf(orderId);
    const both = await Promise.all(["5", "8"].map((value) => applyOrderDiscount({ orderId, version, type: "PERCENT", value, reason: "x" }, waiterId)));
    assert.equal(both.filter((r) => r.ok).length, 1);
    assert.ok(both.some((r) => !r.ok && r.error === STALE));

    // A closed order can't be discounted.
    await prisma.order.update({ where: { id: empty }, data: { status: "CANCELLED", closedAt: new Date() } });
    assert.equal((await discount(empty, { value: "5" })).ok, false);
  });

  test("service charge: on for a new order; switching it off takes it off the bill", async () => {
    const orderId = await billedOrder();
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).serviceCharge, true);
    const version = await versionOf(orderId);
    assert.deepEqual(await setOrderServiceCharge(orderId, version, false), { ok: true, version: version + 1 });
    const bill = await getBill(orderId);
    assert.deepEqual([bill?.order.serviceCharge, bill?.totals.servicePercent, bill?.totals.serviceCharge, bill?.totals.total], [false, "off", formatNaira("0.00"), formatNaira("46.75")]);
    assert.equal((await getOrderScreen(orderId))?.totals.total, formatNaira("46.75"));
    assert.ok((await setOrderServiceCharge(orderId, await versionOf(orderId), true)).ok);
    assert.equal((await getBill(orderId))?.totals.total, formatNaira("51.35"));
    assert.deepEqual(await setOrderServiceCharge(orderId, version, false), { ok: false, error: STALE, stale: true });
  });

  test("any edit after the print clears billPrintedAt and shows Bill changed; kitchen progress and Served don't", async () => {
    const orderId = await billedOrder();
    const jollof = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: dish.jollof }, select: { id: true } });
    const chapman = await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: dish.chapman }, select: { id: true } });
    const print = async () => {
      assert.ok((await registerBillPrint(orderId)).ok);
      const s = await printState(orderId);
      assert.ok(s.billPrintedAt && s.billChangedAt === null, "printed and up to date");
    };
    const expectChanged = async (what: string) => {
      const s = await printState(orderId);
      assert.ok(s.billPrintedAt === null && s.billChangedAt, `${what} marks the bill changed`);
      assert.ok((await getBill(orderId))?.order.billChangedAt, what);
      await print();
    };
    const expectUnchanged = async (what: string) => {
      const s = await printState(orderId);
      assert.ok(s.billPrintedAt && s.billChangedAt === null, `${what} leaves the print alone`);
    };

    // Not printed: an edit marks nothing.
    await tap(orderId, dish.jollof);
    assert.deepEqual(await printState(orderId), { billPrintedAt: null, billChangedAt: null });
    await print();

    // Kitchen progress and Served aren't edits to the order.
    assert.deepEqual(await advanceLine(chapman.id, "PENDING"), { ok: true });
    assert.deepEqual(await advanceLine(chapman.id, "PREPARING"), { ok: true });
    await expectUnchanged("the kitchen marking a line Ready");
    assert.ok((await markLineServed(orderId, await versionOf(orderId), chapman.id)).ok);
    await expectUnchanged("Mark served");

    const v = () => versionOf(orderId);
    const newLine = await prisma.orderItem.findFirstOrThrow({ where: { orderId, kitchenStatus: "NEW", deletedAt: null }, select: { id: true } });
    assert.ok((await setLineQuantity({ orderId, version: await v(), lineId: newLine.id, quantity: 2 })).ok);
    await expectChanged("the stepper");
    await tap(orderId, dish.chapman);
    await expectChanged("adding a line");
    await send(orderId);
    await expectChanged("Send to kitchen");
    assert.ok((await cancelLine({ orderId, version: await v(), lineId: jollof.id, reason: "WRONG_ITEM", details: null }, adminId)).ok);
    await expectChanged("cancelling a line");
    assert.ok((await changeOrderDetails(orderId, await v(), { field: "guests", value: 3 })).ok);
    await expectChanged("the guests");
    assert.ok((await discount(orderId, { value: "5" })).ok);
    await expectChanged("a discount");
    assert.ok((await setOrderServiceCharge(orderId, await v(), false)).ok);
    await expectChanged("the service charge");
    assert.ok((await moveOrder(orderId, await v(), await newTable())).ok);
    await expectChanged("moving table");

    // A refused change marks nothing.
    await discount(orderId, { value: "50" });
    await expectUnchanged("a refused discount");
  });
});
