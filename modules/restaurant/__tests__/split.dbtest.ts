// Split bill (services/bill.ts splitOrderBill / clearOrderSplit) and the
// rules around it against a real database. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/split.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/format";
import { newQrToken } from "../lib/qrToken";
import type { BillSplit } from "../schemas/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, markLineServed, sendToKitchen } from "../server/services/orderFlow";
import { changeOrderDetails, PART_PAID, STALE } from "../server/services/orders";
import { advanceLine } from "../server/services/kitchen";
import { mergeOrders, moveOrder } from "../server/services/tableMoves";
import { getBill } from "../server/queries/bill";
import { applyOrderDiscount, clearOrderSplit, setOrderServiceCharge, splitOrderBill } from "../server/services/bill";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let tableCount = 0;
const dish: Record<"jollof" | "chapman", string> = { jollof: "", chapman: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function newTable() {
  tableCount += 1;
  return (await prisma.table.create({ data: { name: `S${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } })).id;
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
async function send(orderId: string) {
  assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
}
// 2× Jollof ₦18 + 1× Chapman ₦10 (7.5% tax), sent: total ₦51.35 with the 10% service charge.
async function billedOrder() {
  const orderId = await newOrder();
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.jollof);
  await tap(orderId, dish.chapman);
  await send(orderId);
  return orderId;
}
const split = async (orderId: string, s: BillSplit) => splitOrderBill(orderId, await versionOf(orderId), s);
const liveParts = (orderId: string) =>
  prisma.orderBillPart.findMany({
    where: { orderId, deletedAt: null },
    orderBy: { number: "asc" },
    select: { id: true, number: true, mode: true, amount: true, status: true, lines: { select: { orderItemId: true, quantity: true } } },
  });
const lineOf = (orderId: string, productId: string) => prisma.orderItem.findFirstOrThrow({ where: { orderId, productId, deletedAt: null, cancelledAt: null }, select: { id: true } });

describe("Split bill (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 10 } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Split check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Split check" }, select: { id: true } })).id;
    const stationId = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    const make = async (name: string, price: string, orderTax: string) => {
      const product = await prisma.product.create({
        data: { name, code: `SC-${name}-${Date.now()}`, price, orderTax, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.jollof = await make("SC Jollof", "18.00", "0");
    dish.chapman = await make("SC Chapman", "10.00", "7.5");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("equal: N parts that add up exactly, the rounding on the last; the bill shows them", async () => {
    const orderId = await billedOrder();
    const before = await versionOf(orderId);
    assert.deepEqual(await split(orderId, { mode: "EQUAL", ways: 3 }), { ok: true, version: before + 1 });
    const parts = await liveParts(orderId);
    assert.deepEqual(
      parts.map((p) => [p.number, p.mode, p.amount.toFixed(2), p.status, p.lines.length]),
      [
        [1, "EQUAL", "17.11", "OPEN", 0],
        [2, "EQUAL", "17.11", "OPEN", 0],
        [3, "EQUAL", "17.13", "OPEN", 0],
      ],
    );
    const bill = await getBill(orderId);
    assert.equal(bill?.totals.total, formatNaira("51.35"));
    assert.deepEqual(
      bill?.split && { mode: bill.split.mode, modeLabel: bill.split.modeLabel, stale: bill.split.stale, parts: bill.split.parts.map((p) => [p.label, p.amount, p.status]) },
      {
        mode: "EQUAL",
        modeLabel: "Equal split",
        stale: false,
        parts: [
          ["1 of 3", formatNaira("17.11"), "OPEN"],
          ["2 of 3", formatNaira("17.11"), "OPEN"],
          ["3 of 3", formatNaira("17.13"), "OPEN"],
        ],
      },
    );
    assert.equal(bill?.totals.totalValue, "51.35");
  });

  test("by item and by amount; a new split replaces the old one", async () => {
    const orderId = await billedOrder();
    const jollof = await lineOf(orderId, dish.jollof);
    const chapman = await lineOf(orderId, dish.chapman);
    assert.ok((await split(orderId, { mode: "EQUAL", ways: 2 })).ok);
    const old = (await liveParts(orderId)).map((p) => p.id);

    const byItem = await split(orderId, {
      mode: "ITEMS",
      parts: [[{ lineId: jollof.id, quantity: 1 }], [{ lineId: jollof.id, quantity: 1 }, { lineId: chapman.id, quantity: 1 }]],
    });
    assert.ok(byItem.ok);
    const parts = await liveParts(orderId);
    const units = (p: (typeof parts)[number]) => new Set(p.lines.map((l) => `${l.orderItemId}:${l.quantity}`));
    assert.deepEqual(parts.map((p) => [p.mode, p.amount.toFixed(2)]), [
      ["ITEMS", "19.80"],
      ["ITEMS", "31.55"],
    ]);
    assert.deepEqual(units(parts[0]), new Set([`${jollof.id}:1`]));
    assert.deepEqual(units(parts[1]), new Set([`${jollof.id}:1`, `${chapman.id}:1`]));
    const removed = await prisma.orderBillPart.findMany({ where: { id: { in: old } }, select: { deletedAt: true } });
    assert.ok(removed.every((p) => p.deletedAt), "the old split's parts are soft-deleted");
    const bill = await getBill(orderId);
    assert.deepEqual(bill?.split?.parts.map((p) => [p.label, p.items]), [
      ["Guest 1", [{ name: "SC Jollof", quantity: 1 }]],
      ["Guest 2", [{ name: "SC Jollof", quantity: 1 }, { name: "SC Chapman", quantity: 1 }]],
    ]);

    assert.ok((await split(orderId, { mode: "AMOUNT", amounts: ["30", "10.5"] })).ok);
    assert.deepEqual((await liveParts(orderId)).map((p) => [p.mode, p.amount.toFixed(2)]), [
      ["AMOUNT", "30.00"],
      ["AMOUNT", "10.50"],
      ["AMOUNT", "10.85"],
    ]);
    assert.equal(await prisma.orderBillPart.count({ where: { orderId, deletedAt: null } }), 3);
  });

  test("refused: unsent or nothing billed, a bad item split, another order's line, a stale version", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    assert.deepEqual(await split(orderId, { mode: "EQUAL", ways: 2 }), { ok: false, error: "1 line hasn't been sent to the kitchen. Send or remove it first." });
    const empty = await newOrder();
    assert.deepEqual(await split(empty, { mode: "EQUAL", ways: 2 }), { ok: false, error: "Nothing to bill yet." });

    const billed = await billedOrder();
    const other = await billedOrder();
    const jollof = await lineOf(billed, dish.jollof);
    const chapman = await lineOf(billed, dish.chapman);
    const short = await split(billed, { mode: "ITEMS", parts: [[{ lineId: jollof.id, quantity: 1 }], [{ lineId: chapman.id, quantity: 1 }]] });
    assert.deepEqual(short, { ok: false, error: "Assign every SC Jollof (1 of 2 assigned)." });
    const foreign = await lineOf(other, dish.jollof);
    const stolen = await split(billed, {
      mode: "ITEMS",
      parts: [[{ lineId: jollof.id, quantity: 2 }], [{ lineId: chapman.id, quantity: 1 }, { lineId: foreign.id, quantity: 1 }]],
    });
    assert.ok(!stolen.ok && stolen.error.startsWith("An item isn't on the bill"), "another order's line is refused");
    assert.deepEqual(await split(billed, { mode: "AMOUNT", amounts: ["60"] }), { ok: false, error: "Those parts come to ₦60.00 but the bill is ₦51.35. Leave something for the last part." });
    assert.deepEqual(await splitOrderBill(billed, (await versionOf(billed)) - 1, { mode: "EQUAL", ways: 2 }), { ok: false, error: STALE, stale: true });
    assert.equal(await prisma.orderBillPart.count({ where: { orderId: { in: [orderId, empty, billed] } } }), 0, "nothing saved");
  });

  test("Pay as one bill removes the split; with none there it changes nothing", async () => {
    const orderId = await billedOrder();
    const v0 = await versionOf(orderId);
    assert.deepEqual(await clearOrderSplit(orderId, v0), { ok: true, version: v0 }, "no split: no change");
    assert.ok((await split(orderId, { mode: "EQUAL", ways: 2 })).ok);
    const v1 = await versionOf(orderId);
    assert.deepEqual(await clearOrderSplit(orderId, v1), { ok: true, version: v1 + 1 });
    assert.equal((await liveParts(orderId)).length, 0);
    assert.equal((await getBill(orderId))?.split, null);
  });

  test("a change to the bill's money removes the split; other changes keep it", async () => {
    const orderId = await billedOrder();
    const chapman = await lineOf(orderId, dish.chapman);
    const resplit = async () => assert.ok((await split(orderId, { mode: "EQUAL", ways: 2 })).ok);
    const kept = async (what: string) => assert.equal((await liveParts(orderId)).length, 2, `${what} keeps the split`);
    const cleared = async (what: string) => {
      assert.equal((await liveParts(orderId)).length, 0, `${what} removes the split`);
      await resplit();
    };
    await resplit();

    assert.ok((await changeOrderDetails(orderId, await versionOf(orderId), { field: "guests", value: 2 })).ok);
    await kept("the guests");
    assert.deepEqual(await advanceLine(chapman.id, "PENDING"), { ok: true });
    assert.deepEqual(await advanceLine(chapman.id, "PREPARING"), { ok: true });
    await kept("the kitchen");
    assert.ok((await markLineServed(orderId, await versionOf(orderId), chapman.id)).ok);
    await kept("Mark served");
    await tap(orderId, dish.jollof);
    await kept("adding an unsent line (it isn't on the bill yet)");

    await send(orderId);
    await cleared("Send to kitchen");
    const jollof = await lineOf(orderId, dish.jollof);
    assert.ok((await cancelLine({ orderId, version: await versionOf(orderId), lineId: jollof.id, reason: "CHANGED_MIND", details: null }, userId)).ok);
    await cleared("cancelling a line");
    assert.ok((await applyOrderDiscount({ orderId, version: await versionOf(orderId), type: "PERCENT", value: "5", reason: "x" }, userId)).ok);
    await cleared("a discount");
    assert.ok((await setOrderServiceCharge(orderId, await versionOf(orderId), false)).ok);
    await cleared("the service charge");
    const other = await billedOrder();
    assert.ok((await split(other, { mode: "EQUAL", ways: 2 })).ok);
    assert.ok((await mergeOrders(other, await versionOf(other), orderId)).ok);
    assert.equal((await liveParts(orderId)).length, 0, "merging into it removes its split");
    assert.equal((await liveParts(other)).length, 0, "and the merged order's");
  });

  test("once a part is paid the bill is fixed: money changes refused, the rest allowed", async () => {
    const orderId = await billedOrder();
    assert.ok((await split(orderId, { mode: "EQUAL", ways: 2 })).ok);
    const [first] = await liveParts(orderId);
    // Paying comes with Part 6 Step 6; marked here directly.
    await prisma.orderBillPart.update({ where: { id: first.id }, data: { status: "PAID", paidAt: new Date() } });
    const chapman = await lineOf(orderId, dish.chapman);
    const v = () => versionOf(orderId);

    assert.deepEqual(await addLine({ orderId, version: await v(), productId: dish.jollof, modifierIds: [], note: null }), { ok: false, error: PART_PAID });
    assert.deepEqual(await sendToKitchen(orderId, await v(), userId), { ok: false, error: PART_PAID });
    assert.deepEqual(await cancelLine({ orderId, version: await v(), lineId: chapman.id, reason: "CHANGED_MIND", details: null }, userId), { ok: false, error: PART_PAID });
    assert.deepEqual(await applyOrderDiscount({ orderId, version: await v(), type: "PERCENT", value: "5", reason: "x" }, userId), { ok: false, error: PART_PAID });
    assert.deepEqual(await setOrderServiceCharge(orderId, await v(), false), { ok: false, error: PART_PAID });
    assert.deepEqual(await split(orderId, { mode: "EQUAL", ways: 3 }), { ok: false, error: PART_PAID });
    assert.deepEqual(await clearOrderSplit(orderId, await v()), { ok: false, error: PART_PAID });
    const other = await billedOrder();
    const into = await mergeOrders(other, await versionOf(other), orderId);
    assert.ok(!into.ok && into.error.includes("has been paid"), "nothing can join it");
    assert.deepEqual(await mergeOrders(orderId, await v(), other), { ok: false, error: PART_PAID }, "nor can it join another");
    assert.equal((await liveParts(orderId)).length, 2, "the split is untouched");

    assert.ok((await changeOrderDetails(orderId, await v(), { field: "guests", value: 4 })).ok, "the ticket header still works");
    assert.deepEqual(await advanceLine(chapman.id, "PENDING"), { ok: true });
    assert.deepEqual(await advanceLine(chapman.id, "PREPARING"), { ok: true });
    assert.ok((await markLineServed(orderId, await v(), chapman.id)).ok, "Mark served still works");
    assert.ok((await moveOrder(orderId, await v(), await newTable())).ok, "moving table still works");
  });

  test("two devices splitting at once: one split wins, whole", async () => {
    const orderId = await billedOrder();
    const version = await versionOf(orderId);
    const results = await Promise.all([splitOrderBill(orderId, version, { mode: "EQUAL", ways: 2 }), splitOrderBill(orderId, version, { mode: "EQUAL", ways: 4 })]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.some((r) => !r.ok && r.error === STALE));
    const parts = await liveParts(orderId);
    assert.ok(parts.length === 2 || parts.length === 4);
    assert.ok(parts.every((p) => p.amount.toFixed(2) === parts[0].amount.toFixed(2) || p.number === parts.length));
    assert.equal(parts.reduce((s, p) => s.plus(p.amount.toString()), new Decimal(0)).toFixed(2), "51.35");
  });

  test("a settings change that moves the total marks the split stale", async () => {
    const orderId = await billedOrder();
    assert.ok((await split(orderId, { mode: "EQUAL", ways: 2 })).ok);
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantServiceChargePercent: 12.5 } });
    try {
      assert.equal((await getBill(orderId))?.split?.stale, true);
    } finally {
      await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantServiceChargePercent: 10 } });
    }
    assert.equal((await getBill(orderId))?.split?.stale, false);
  });
});
