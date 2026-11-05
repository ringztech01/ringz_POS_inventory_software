// Waste Step 4 against a real database: Remake from the kitchen display
// (services/remake.ts) and Returned by guest from the order screen
// (services/orderFlow.ts cancelLine). Remake logs the spoilt dishes as waste
// and sends a no-charge remake line on its own ticket — the guest is billed
// once, and stock moves exactly once per dish made. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/remake.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { getBill } from "../server/queries/bill";
import { getOrderScreen } from "../server/queries/orderScreen";
import { setApprovalPin } from "../server/services/approvalPins";
import { openTableOrder } from "../server/services/floor";
import { advanceLine } from "../server/services/kitchen";
import { cancelLine, markLineServed, sendToKitchen } from "../server/services/orderFlow";
import { addLine } from "../server/services/orderLines";
import { remakeLine } from "../server/services/remake";
import { settleOrder } from "../server/services/settle";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const stamp = Date.now();
let adminId = "";
let approverId = "";
let warehouseId = "";
let areaId = "";
const id: Record<"stew" | "beef" | "oil" | "plain", string> = { stew: "", beef: "", oil: "", plain: "" };

const stock = async (productId: string) => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).quantity;
const version = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).version;
const setLimit = (limit: number) => prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteApprovalLimit: limit } });
const counts = async () => ({
  waste: await prisma.wasteEntry.count(),
  lines: await prisma.orderItem.count(),
  kots: await prisma.kot.count(),
  stock: (await prisma.productStock.findMany({ orderBy: { id: "asc" }, select: { quantity: true } })).map((s) => s.quantity),
});

// An order with `quantity` of the dish, sent; `step` how far the kitchen got.
async function orderWith(productId: string, quantity: number, step: "PENDING" | "PREPARING" | "READY" | "SERVED") {
  const table = await prisma.table.create({ data: { name: `RM${Math.floor(Math.random() * 1e6)}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, adminId);
  assert.ok(opened.ok, JSON.stringify(opened));
  const orderId = opened.orderId;
  for (let i = 0; i < quantity; i++) assert.ok((await addLine({ orderId, version: await version(orderId), productId, modifierIds: [], note: null })).ok);
  assert.ok((await sendToKitchen(orderId, await version(orderId), adminId)).ok);
  const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true, quantity: true } });
  assert.equal(line.quantity, quantity);
  if (step !== "PENDING") assert.ok((await advanceLine(line.id, "PENDING")).ok);
  if (step === "READY" || step === "SERVED") assert.ok((await advanceLine(line.id, "PREPARING")).ok);
  if (step === "SERVED") assert.ok((await markLineServed(orderId, await version(orderId), line.id)).ok);
  return { orderId, lineId: line.id };
}

describe("Remake and Returned by guest (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    const role = await prisma.role.create({ data: { name: `chk remake approver ${stamp}`, permissions: { create: [{ permission: "Approve Waste" }] } }, select: { id: true } });
    approverId = (await prisma.user.create({ data: { firstName: "Remake", lastName: "Approver", email: `chk-remake-${stamp}@example.test`, password: "x", roleId: role.id }, select: { id: true } })).id;
    assert.ok((await setApprovalPin(approverId, "2468")).ok);
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantWarehouseId: warehouseId }, update: { restaurantWarehouseId: warehouseId, restaurantWasteApprovalLimit: 0, restaurantServiceChargePercent: 0 } });
    if (!(await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null } }))) {
      await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true } });
    }
    if (!(await prisma.kitchenStation.findFirst({ where: { deletedAt: null, isActive: true } }))) {
      await prisma.kitchenStation.create({ data: { code: `RM${stamp % 1000}`, name: "Remake check", lateAfterMin: 15 } });
    }
    areaId = (await prisma.diningArea.create({ data: { name: `Remake check ${stamp}`, warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.create({ data: { name: `RMu${stamp}` } })).id;
    const categoryId = (await prisma.category.create({ data: { name: `Remake check ${stamp}` }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, price: string, cost: string | null, productType: "MENU_ITEM" | "INGREDIENT", quantity: number) => {
      const product = await prisma.product.create({ data: { name: `RM ${key} ${stamp}`, code: `RM-${key}-${stamp}`, price, cost, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType, showOnMenu: true, isAvailable: true } });
      id[key] = product.id;
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity } });
    };
    await make("stew", "40.00", null, "MENU_ITEM", 0);
    await make("beef", "1", "2.50", "INGREDIENT", 1000);
    await make("oil", "1", "0.05", "INGREDIENT", 100000);
    await make("plain", "12.00", "3.00", "MENU_ITEM", 50);
    await prisma.recipeLine.createMany({
      data: [
        { menuItemId: id.stew, ingredientId: id.beef, quantity: 2 },
        { menuItemId: id.stew, ingredientId: id.oil, quantity: 30 },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("Remake 1 of 2: waste logged for the line, a no-charge remake line on its own REMAKE ticket; the original untouched", async () => {
    const { orderId, lineId } = await orderWith(id.stew, 2, "PREPARING");
    const before = { beef: await stock(id.beef), oil: await stock(id.oil), version: await version(orderId), bill: (await getBill(orderId))!.totals.total };
    const original = await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } });

    const result = await remakeLine({ itemId: lineId, qty: 1, reason: "BURNT", note: "Left on the grill", approval: undefined }, adminId);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.costSnapshot, "6.50");

    const waste = await prisma.wasteEntry.findUniqueOrThrow({ where: { id: result.wasteId }, include: { lines: true } });
    assert.deepEqual([waste.orderItemId, waste.reason, waste.qty.toString(), waste.note, waste.status, waste.loggedById], [lineId, "BURNT", "1", "Left on the grill", "ACTIVE", adminId]);
    assert.deepEqual([before.beef - (await stock(id.beef)), before.oil - (await stock(id.oil))], [2, 30], "one stew's ingredients out");

    const remake = await prisma.orderItem.findUniqueOrThrow({ where: { id: result.lineId } });
    assert.deepEqual(
      [remake.orderId, remake.productId, remake.quantity, remake.unitPrice.toFixed(2), remake.taxRate.toFixed(2), remake.remakeOfId, remake.kitchenStatus, remake.stationId, !!remake.sentAt],
      [orderId, id.stew, 1, "0.00", "0.00", lineId, "PENDING", original.stationId, true],
    );
    const kot = await prisma.kot.findFirstOrThrow({ where: { lines: { some: { orderItemId: result.lineId } } }, include: { lines: true } });
    assert.deepEqual([kot.type, kot.note, kot.stationId, kot.lines.length, kot.lines[0].quantity, kot.bumpedAt], ["NEW", "REMAKE: Burnt — Left on the grill", original.stationId, 1, 1, null]);

    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } });
    assert.deepEqual([after.quantity, after.unitPrice.toFixed(2), after.kitchenStatus, after.remakeOfId], [2, original.unitPrice.toFixed(2), "PREPARING", null], "the original is untouched");
    assert.equal(await version(orderId), before.version + 1, "the order screen refreshes");
    assert.equal((await getBill(orderId))!.totals.total, before.bill, "the bill is the same");
    const screen = await getOrderScreen(orderId);
    const shown = screen!.lines.find((l) => l.id === result.lineId)!;
    assert.deepEqual([shown.remake, shown.amount], [true, "₦0.00"]);
  });

  test("billed once: settle sells the original line only, and takes stock for it only — the remake's came from the waste", async () => {
    const { orderId, lineId } = await orderWith(id.stew, 2, "READY");
    const start = { beef: await stock(id.beef), oil: await stock(id.oil) };
    const remade = await remakeLine({ itemId: lineId, qty: 2, reason: "DROPPED", note: "", approval: undefined }, adminId);
    assert.ok(remade.ok, JSON.stringify(remade));
    assert.equal((await prisma.kot.findFirstOrThrow({ where: { lines: { some: { orderItemId: remade.lineId } } } })).note, "REMAKE: Dropped");
    const bill = (await getBill(orderId))!;
    assert.deepEqual(bill.lines.map((l) => [l.name, l.quantity]), [[`RM stew ${stamp}`, 2]], "the remake isn't on the bill");
    const settled = await settleOrder({ orderId, version: await version(orderId), payments: [{ paymentType: "CASH", amount: "80" }], tip: "0", idempotencyKey: randomUUID() }, adminId);
    assert.ok(settled.ok, JSON.stringify(settled));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { saleId: true } });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: order.saleId! }, include: { items: true } });
    assert.deepEqual([sale.grandTotal.toFixed(2), sale.items.map((i) => [i.productId, i.quantity])], ["80.00", [[id.stew, 2]]]);
    // 2 made and served (settle) + 2 spoilt (waste) = 4 stews' ingredients; the 2 remade aren't taken again.
    assert.deepEqual([start.beef - (await stock(id.beef)), start.oil - (await stock(id.oil))], [8, 120]);
    const remakeLineRow = await prisma.orderItem.findUniqueOrThrow({ where: { id: remade.lineId } });
    assert.equal(remakeLineRow.stockPerUnit, null, "nothing recorded to refund for the remake");
  });

  test("a remake of a remake points at the billed line; a Served order is Sent again", async () => {
    const { orderId, lineId } = await orderWith(id.plain, 1, "SERVED");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "SERVED");
    // Served lines aren't remade (the guest has it: that's Returned by guest).
    assert.deepEqual(await remakeLine({ itemId: lineId, qty: 1, reason: "BURNT", note: "", approval: undefined }, adminId), { ok: false, error: "Only a dish being made or ready can be remade — refreshed.", stale: true });
    const second = await orderWith(id.plain, 1, "READY");
    await prisma.order.update({ where: { id: second.orderId }, data: { status: "SERVED" } });
    const first = await remakeLine({ itemId: second.lineId, qty: 1, reason: "BURNT", note: "", approval: undefined }, adminId);
    assert.ok(first.ok, JSON.stringify(first));
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: second.orderId } })).status, "SENT");
    assert.ok((await advanceLine(first.lineId, "PENDING")).ok);
    const again = await remakeLine({ itemId: first.lineId, qty: 1, reason: "DROPPED", note: "", approval: undefined }, adminId);
    assert.ok(again.ok, JSON.stringify(again));
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: again.lineId } })).remakeOfId, second.lineId);
    // Its waste is linked to the line that was spoilt (the first remake).
    assert.equal((await prisma.wasteEntry.findUniqueOrThrow({ where: { id: again.wasteId } })).orderItemId, first.lineId);
    // A dish without a recipe: itself comes out.
    assert.equal(first.costSnapshot, "3.00");
  });

  test("refused, nothing written: still pending, more than the line, cancelled, over the limit without a PIN, a wrong PIN, not enough stock", async () => {
    const pending = await orderWith(id.stew, 1, "PENDING");
    const making = await orderWith(id.stew, 2, "PREPARING");
    const before = await counts();
    const remake = (itemId: string, qty: number, approval?: { approverId: string; pin: string }) => remakeLine({ itemId, qty, reason: "BURNT", note: "", approval }, adminId);
    assert.deepEqual(await remake(pending.lineId, 1), { ok: false, error: "Only a dish being made or ready can be remade — refreshed.", stale: true });
    assert.deepEqual(await remake(making.lineId, 3), { ok: false, error: "The line has 2 — remake at most 2." });
    await setLimit(10);
    try {
      const over = await remake(making.lineId, 2);
      assert.ok(!over.ok && over.needsApproval && over.limit === "₦10.00", JSON.stringify(over));
      const wrong = await remake(making.lineId, 2, { approverId, pin: "1111" });
      assert.ok(!wrong.ok && /PIN/.test(wrong.error), JSON.stringify(wrong));
      await prisma.approvalPin.update({ where: { userId: approverId }, data: { failedAttempts: 0 } });
    } finally {
      await setLimit(0);
    }
    const beefRow = await prisma.productStock.findFirstOrThrow({ where: { productId: id.beef, warehouseId } });
    await prisma.productStock.update({ where: { id: beefRow.id }, data: { quantity: 3 } });
    try {
      const short = await remake(making.lineId, 2);
      assert.ok(!short.ok && /stock/i.test(short.error), JSON.stringify(short));
    } finally {
      await prisma.productStock.update({ where: { id: beefRow.id }, data: { quantity: beefRow.quantity } });
    }
    assert.deepEqual(await counts(), before, "no waste, line, ticket or stock change");
    // Cancelled since the screen showed it.
    assert.ok((await cancelLine({ orderId: making.orderId, version: await version(making.orderId), lineId: making.lineId, reason: "CHANGED_MIND", details: null }, adminId)).ok);
    assert.deepEqual(await remake(making.lineId, 1), { ok: false, error: "That dish is no longer on a live order — refreshed.", stale: true });
  });

  test("with an approver's PIN over the limit: approved by them", async () => {
    const { lineId } = await orderWith(id.stew, 2, "PREPARING");
    await setLimit(10);
    try {
      const result = await remakeLine({ itemId: lineId, qty: 2, reason: "BURNT", note: "", approval: { approverId, pin: "2468" } }, adminId);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal((await prisma.wasteEntry.findUniqueOrThrow({ where: { id: result.wasteId } })).approvedById, approverId);
    } finally {
      await setLimit(0);
    }
  });

  test("Returned by guest, wasted: the line cancelled and its food logged as waste, in one go", async () => {
    const { orderId, lineId } = await orderWith(id.stew, 2, "SERVED");
    const start = { beef: await stock(id.beef), oil: await stock(id.oil) };
    const result = await cancelLine({ orderId, version: await version(orderId), lineId, reason: "RETURNED_BY_GUEST", details: "Too salty", wasted: true }, adminId);
    assert.ok(result.ok, JSON.stringify(result));
    const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: lineId } });
    assert.deepEqual([!!line.cancelledAt, line.cancelReason], [true, "Returned by guest: Too salty"]);
    const waste = await prisma.wasteEntry.findFirstOrThrow({ where: { orderItemId: lineId } });
    assert.deepEqual([waste.reason, waste.qty.toString(), waste.note, waste.costSnapshot.toFixed(2), waste.loggedById], ["RETURNED_BY_GUEST", "2", "Too salty", "13.00", adminId]);
    assert.deepEqual([start.beef - (await stock(id.beef)), start.oil - (await stock(id.oil))], [4, 60]);
    assert.ok((await prisma.kot.findFirst({ where: { type: "VOID", lines: { some: { orderItemId: lineId } } } })), "the kitchen got its VOID");
  });

  test("Returned by guest, not wasted: cancelled only; refused for a line that isn't served, and over the limit without a PIN (nothing cancelled)", async () => {
    const served = await orderWith(id.plain, 1, "SERVED");
    const before = await prisma.wasteEntry.count();
    assert.ok((await cancelLine({ orderId: served.orderId, version: await version(served.orderId), lineId: served.lineId, reason: "RETURNED_BY_GUEST", details: null, wasted: false }, adminId)).ok);
    assert.equal(await prisma.wasteEntry.count(), before, "no waste");

    const ready = await orderWith(id.plain, 1, "READY");
    assert.deepEqual(await cancelLine({ orderId: ready.orderId, version: await version(ready.orderId), lineId: ready.lineId, reason: "RETURNED_BY_GUEST", details: null, wasted: true }, adminId), {
      ok: false,
      error: "Returned by guest is for a line that's been served.",
    });

    const big = await orderWith(id.stew, 2, "SERVED");
    await setLimit(10);
    try {
      const v = await version(big.orderId);
      const over = await cancelLine({ orderId: big.orderId, version: v, lineId: big.lineId, reason: "RETURNED_BY_GUEST", details: null, wasted: true }, adminId);
      assert.ok(!over.ok && "needsApproval" in over && over.needsApproval, JSON.stringify(over));
      const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: big.lineId } });
      assert.deepEqual([line.cancelledAt, await version(big.orderId)], [null, v], "nothing cancelled, the version unchanged");
      const approved = await cancelLine({ orderId: big.orderId, version: v, lineId: big.lineId, reason: "RETURNED_BY_GUEST", details: null, wasted: true, approval: { approverId, pin: "2468" } }, adminId);
      assert.ok(approved.ok, JSON.stringify(approved));
      assert.equal((await prisma.wasteEntry.findFirstOrThrow({ where: { orderItemId: big.lineId } })).approvedById, approverId);
    } finally {
      await setLimit(0);
    }
  });
});
