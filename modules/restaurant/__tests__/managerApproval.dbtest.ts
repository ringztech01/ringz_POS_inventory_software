// The touch POS's manager PIN against a real database (Part 6e Step 6):
// voiding a sent line and refunds need Approve Voids & Refunds — or the PIN
// of someone with it; opening the drawer by hand needs Open Drawer — or the
// PIN of someone with it. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/managerApproval.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { newQrToken } from "../lib/qrToken";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { requireManager, setApprovalPin } from "../server/services/approvalPins";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, sendToKitchen } from "../server/services/orderFlow";
import { refundOrder } from "../server/services/refund";
import { getVoidApprovers, getDrawerApprovers } from "../server/queries/approvers";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const user: Record<"waiter" | "manager" | "cashier", string> = { waiter: "", manager: "", cashier: "" };
let dishId = "";
let areaId = "";

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function sentLine() {
  const table = await prisma.table.create({ data: { name: testTable(`MA${Date.now() % 100000}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, user.waiter);
  assert.ok(opened.ok);
  assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dishId, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), user.waiter)).ok);
  const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: opened.orderId }, select: { id: true } });
  return { orderId: opened.orderId, lineId: line.id };
}

describe("Manager PIN (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const stamp = Date.now();
    const role = async (name: string, permissions: string[]) =>
      (await prisma.role.create({ data: { name: `${name} ${stamp}`, permissions: { create: permissions.map((permission) => ({ permission })) } }, select: { id: true } })).id;
    const make = async (first: string, roleId: string) =>
      (await prisma.user.create({ data: { firstName: first, lastName: "Check", email: `${first.toLowerCase()}-${stamp}@check.test`, password: await bcrypt.hash("x", 4), roleId }, select: { id: true } })).id;
    user.waiter = await make("Wale", await role("MA waiter", [P.MANAGE_ORDERS]));
    user.manager = await make("Mona", await role("MA manager", [P.MANAGE_ORDERS, P.APPROVE_VOID]));
    user.cashier = await make("Cash", await role("MA cashier", [P.MANAGE_ORDERS, P.SETTLE_BILL, PERMISSIONS.OPEN_DRAWER]));
    for (const id of Object.values(user)) assert.ok((await setApprovalPin(id, "2580")).ok);

    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Manager check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Manager check" }, select: { id: true } })).id;
    const stationId = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    dishId = (await prisma.product.create({ data: { name: "MA Soup", code: `MA-${stamp}`, price: "10.00", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dishId, warehouseId, quantity: 100 } });
  });
  after(() => prisma.$disconnect());

  test("void a sent line without Approve Voids & Refunds: refused until a manager's PIN comes; nothing changes meanwhile", async () => {
    const { orderId, lineId } = await sentLine();
    const base = { orderId, lineId, reason: "WRONG_ITEM" as const, details: null };
    const asked = await cancelLine({ ...base, version: await versionOf(orderId) }, user.waiter, { mayVoid: false });
    assert.deepEqual(asked, { ok: false, error: "Voiding a sent line needs a manager's PIN.", needsManager: "VOID" });
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } })).cancelledAt, null);
    // Someone without the permission can't approve, even with their PIN.
    const notManager = await cancelLine({ ...base, version: await versionOf(orderId), managerApproval: { approverId: user.cashier, pin: "2580" } }, user.waiter, { mayVoid: false });
    assert.equal(!notManager.ok && notManager.error, "That person can't approve voids and refunds. Pick someone else.");
    const wrong = await cancelLine({ ...base, version: await versionOf(orderId), managerApproval: { approverId: user.manager, pin: "0000" } }, user.waiter, { mayVoid: false });
    assert.equal(!wrong.ok && wrong.error, "That PIN isn't right.");
    assert.equal((await prisma.approvalPin.findUniqueOrThrow({ where: { userId: user.manager } })).failedAttempts, 1, "counted");
    const approved = await cancelLine({ ...base, version: await versionOf(orderId), managerApproval: { approverId: user.manager, pin: "2580" } }, user.waiter, { mayVoid: false });
    assert.ok(approved.ok, JSON.stringify(approved));
    const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } });
    assert.ok(line.cancelledAt);
    assert.equal(line.cancelReason, "Wrong item · approved by Mona");
    assert.equal(line.cancelledById, user.waiter, "the waiter voided it; Mona approved");
  });

  test("Part 6f Step 8: a manager's PIN approves that one action only — the next void asks again — and it's logged against both people", async () => {
    const first = await sentLine();
    const second = await sentLine();
    const approved = await cancelLine(
      { orderId: first.orderId, lineId: first.lineId, version: await versionOf(first.orderId), reason: "WRONG_ITEM", details: null, managerApproval: { approverId: user.manager, pin: "2580" } },
      user.waiter,
      { mayVoid: false },
    );
    assert.ok(approved.ok, JSON.stringify(approved));
    const next = await cancelLine({ orderId: second.orderId, lineId: second.lineId, version: await versionOf(second.orderId), reason: "WRONG_ITEM", details: null }, user.waiter, { mayVoid: false });
    assert.deepEqual(next, { ok: false, error: "Voiding a sent line needs a manager's PIN.", needsManager: "VOID" }, "the approval doesn't carry over");
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: second.lineId } })).cancelledAt, null);
    const logs = await prisma.auditLog.findMany({ where: { entityId: first.lineId, action: { startsWith: "override.void" } }, orderBy: { action: "asc" }, select: { userId: true, action: true, meta: true } });
    assert.deepEqual(
      logs.map((l) => [l.action, l.userId, (l.meta as { approvedById?: string; forUserId?: string }).approvedById ?? (l.meta as { forUserId?: string }).forUserId]),
      [
        ["override.void", user.waiter, user.manager],
        ["override.void.approve", user.manager, user.waiter],
      ],
    );
    assert.equal(await prisma.auditLog.count({ where: { entityId: second.lineId } }), 0, "nothing logged for the refused one");
  });

  test("with Approve Voids & Refunds: no PIN", async () => {
    const { orderId, lineId } = await sentLine();
    const done = await cancelLine({ orderId, lineId, version: await versionOf(orderId), reason: "WRONG_ITEM", details: null }, user.manager, { mayVoid: true });
    assert.ok(done.ok);
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } })).cancelReason, "Wrong item");
  });

  test("a refund without it: a manager's PIN first (before anything else is looked at)", async () => {
    const input = { orderId: "no-such-order", lines: [{ saleItemId: "x", quantity: 1 }], returnToStock: false, paymentType: "CASH" as const, reason: "Cold food", idempotencyKey: crypto.randomUUID() };
    assert.deepEqual(await refundOrder(input, user.cashier, { mayRefund: false }), { ok: false, error: "A refund needs a manager's PIN.", needsManager: "REFUND" });
    const approved = await refundOrder({ ...input, managerApproval: { approverId: user.manager, pin: "2580" } }, user.cashier, { mayRefund: false });
    assert.equal(!approved.ok && approved.error, "Order not found. It may have been deleted.", "approved, so it went on to the order");
    assert.equal(!(await refundOrder(input, user.manager, { mayRefund: true })).ok, true);
  });

  test("the drawer: Open Drawer holders approve; others can't; the approver lists", async () => {
    const ask = (approval?: { approverId: string; pin: string }, may = false) => prisma.$transaction((tx) => requireManager(tx, { for: "DRAWER", may, approval }));
    assert.deepEqual(await ask(undefined, true), { ok: true, approvedBy: null, approverId: null });
    assert.deepEqual(await ask(), { ok: false, error: "Opening the drawer needs a manager's PIN.", needsManager: "DRAWER" });
    assert.deepEqual(await ask({ approverId: user.cashier, pin: "2580" }), { ok: true, approvedBy: "Cash", approverId: user.cashier });
    const refused = await ask({ approverId: user.manager, pin: "2580" });
    assert.equal(!refused.ok && refused.error, "That person can't approve opening the drawer. Pick someone else.");
    const voids = (await getVoidApprovers()).map((a) => a.id);
    const drawers = (await getDrawerApprovers()).map((a) => a.id);
    assert.ok(voids.includes(user.manager) && !voids.includes(user.waiter) && !voids.includes(user.cashier));
    assert.ok(drawers.includes(user.cashier) && !drawers.includes(user.waiter));
  });
});
