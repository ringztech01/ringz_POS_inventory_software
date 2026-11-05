// The bill (getBill) and Print bill (registerBillPrint) against a real
// database. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/bill.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { newQrToken } from "../lib/qrToken";
import { summariseBill } from "../lib/bill";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, markLineServed, sendToKitchen } from "../server/services/orderFlow";
import { getBill } from "../server/queries/bill";
import { BILL_ORDER_GONE, registerBillPrint } from "../server/services/bill";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let tableCount = 0;
const dish: Record<"jollof" | "chapman" | "soup", string> = { jollof: "", chapman: "", soup: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function newOrder() {
  tableCount += 1;
  const table = await prisma.table.create({ data: { name: `B${tableCount}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  return opened.orderId;
}
async function tap(orderId: string, productId: string, note: string | null = null) {
  const result = await addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note });
  assert.ok(result.ok, JSON.stringify(result));
}
async function send(orderId: string) {
  const result = await sendToKitchen(orderId, await versionOf(orderId), userId);
  assert.ok(result.ok, JSON.stringify(result));
}
const lineOf = (orderId: string, productId: string) => prisma.orderItem.findFirstOrThrow({ where: { orderId, productId, deletedAt: null }, select: { id: true } });

describe("Bill (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Bill check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Bill check" }, select: { id: true } })).id;
    const make = async (name: string, price: string, taxRate: string) => {
      const product = await prisma.product.create({
        data: { name, code: `BC-${name}-${Date.now()}`, price, orderTax: taxRate, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 50 } });
      return product.id;
    };
    dish.jollof = await make("BC Jollof", "18.00", "0");
    dish.chapman = await make("BC Chapman", "10.00", "7.5");
    dish.soup = await make("BC Soup", "26.00", "0");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("billed lines only, with server totals and the warnings", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof, "no pepper");
    await tap(orderId, dish.jollof, "no pepper");
    await tap(orderId, dish.chapman);
    await tap(orderId, dish.soup);
    await send(orderId);
    // Soup is cancelled (VOID), chapman served, a new dish waits unsent.
    const soup = await lineOf(orderId, dish.soup);
    assert.ok((await cancelLine({ orderId, version: await versionOf(orderId), lineId: soup.id, reason: "CHANGED_MIND", details: null }, userId)).ok);
    const chapman = await lineOf(orderId, dish.chapman);
    // The kitchen marks it Ready (as the KDS would), then the waiter serves it.
    await prisma.orderItem.update({ where: { id: chapman.id }, data: { kitchenStatus: "READY", readyAt: new Date() } });
    assert.ok((await markLineServed(orderId, await versionOf(orderId), chapman.id)).ok);
    await tap(orderId, dish.soup);

    const bill = await getBill(orderId);
    assert.ok(bill);
    assert.deepEqual(
      bill.lines.map((l) => [l.name, l.quantity, l.amount, l.note, l.status, l.served]),
      [
        ["BC Jollof", 2, formatNaira("36.00"), "no pepper", "Sent", false],
        ["BC Chapman", 1, formatNaira("10.00"), null, "Served", true],
      ],
    );
    const { restaurantServiceChargePercent } = await getBusinessSettings();
    const expected = summariseBill(
      [
        { quantity: 2, unitPrice: "18.00", taxType: "EXCLUSIVE", taxRate: "0", cancelledAt: null, deletedAt: null, kitchenStatus: "PENDING" },
        { quantity: 1, unitPrice: "10.00", taxType: "EXCLUSIVE", taxRate: "7.5", cancelledAt: null, deletedAt: null, kitchenStatus: "SERVED" },
      ],
      restaurantServiceChargePercent,
    );
    assert.equal(bill.totals.subTotal, formatNaira("46.00"));
    assert.equal(bill.totals.tax, formatNaira("0.75"));
    assert.equal(bill.totals.total, formatNaira(expected.total.toFixed(2)));
    assert.equal(bill.totals.taxLabel, "Tax (7.5%)");
    assert.deepEqual([bill.unsent, bill.notServed], [1, 1]);
    assert.equal(bill.settleBlocker, "1 line hasn't been sent to the kitchen. Send or remove it first.");
    assert.equal(bill.order.billPrintedAt, null);
    assert.equal(bill.order.editable, true);

    // Sent: nothing blocks any more; the not-served warning stays.
    await send(orderId);
    const sent = await getBill(orderId);
    assert.ok(sent);
    assert.deepEqual([sent.lines.length, sent.unsent, sent.notServed, sent.settleBlocker], [3, 0, 2, null]);
  });

  test("an order with nothing sent, a missing order, a deleted one", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    const bill = await getBill(orderId);
    assert.ok(bill);
    assert.deepEqual([bill.lines.length, bill.unsent, bill.totals.total], [0, 1, formatNaira("0.00")]);
    assert.equal(await getBill("no-such-order"), null);
    await prisma.order.update({ where: { id: orderId }, data: { deletedAt: new Date() } });
    assert.equal(await getBill(orderId), null);
  });

  test("Print bill sets billPrintedAt only — status, version and lines unchanged", async () => {
    const orderId = await newOrder();
    await tap(orderId, dish.jollof);
    await send(orderId);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, version: true, updatedAt: true, billPrintedAt: true } });
    const linesBefore = await prisma.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } });
    assert.equal(before.billPrintedAt, null);

    const started = Date.now();
    assert.deepEqual(await registerBillPrint(orderId), { ok: true });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, version: true, billPrintedAt: true } });
    assert.deepEqual([after.status, after.version], [before.status, before.version]);
    assert.ok(after.billPrintedAt && after.billPrintedAt.getTime() >= started - 1000);
    assert.deepEqual(await prisma.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } }), linesBefore);
    assert.equal((await getBill(orderId))?.order.billPrintedAt, after.billPrintedAt.toISOString());

    // A reprint moves the time on.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok((await registerBillPrint(orderId)).ok);
    const again = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { billPrintedAt: true, version: true } });
    assert.ok(again.billPrintedAt! > after.billPrintedAt);
    assert.equal(again.version, before.version);
  });

  test("Print bill on a closed, cancelled or missing order is refused and changes nothing", async () => {
    const billed = await newOrder();
    await prisma.order.update({ where: { id: billed }, data: { status: "BILLED", closedAt: new Date() } });
    assert.deepEqual(await registerBillPrint(billed), { ok: false, error: BILL_ORDER_GONE });
    const cancelled = await newOrder();
    await prisma.order.update({ where: { id: cancelled }, data: { status: "CANCELLED", closedAt: new Date() } });
    assert.deepEqual(await registerBillPrint(cancelled), { ok: false, error: BILL_ORDER_GONE });
    assert.deepEqual(await registerBillPrint("no-such-order"), { ok: false, error: BILL_ORDER_GONE });
    const rows = await prisma.order.findMany({ where: { id: { in: [billed, cancelled] } }, select: { billPrintedAt: true } });
    assert.ok(rows.every((r) => r.billPrintedAt === null));
    // A closed order's bill still shows, read-only, with nothing to settle.
    assert.equal((await getBill(billed))?.settleBlocker, "This order is closed.");
  });
});
