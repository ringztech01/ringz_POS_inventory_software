// Restaurant Reports, Step 9, against a real database (a throwaway copy):
// shifts clocked the real way — one ending with its open table handed over —
// and a till opened, a cash bill and a cash refund taken at it, the drawer
// opened, closed with the cash counted short; then Shifts & cash-up: each
// shift's hours, orders, net sales and handover; the till's figures as
// counted and its variance against the limit; the Z-report reprint going to
// the print queue (only for a closed till). Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportShifts.dbtest.ts
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
import { endShift, startShift } from "../server/services/shifts";
import { closeTill, openTill, printZReport } from "../server/services/till";
import { shiftLines, tillLines } from "../lib/reportShifts";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getShiftsReport } from "../server/queries/reports/shifts";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Shifts and the till are timed now, so the report's default period (the
// last 7 days) holds them; each filter keeps this file's own.
const user: Record<"ada" | "tayo", string> = { ada: "", tayo: "" };
let areaId = "";
let dish = "";
const till = randomUUID();
let session = "";
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function sent(waiterId: string) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RSH${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, waiterId);
  assert.ok(opened.ok);
  for (let i = 0; i < 2; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId: dish, modifierIds: [], note: i ? "second" : null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), waiterId)).ok);
  return opened.orderId;
}

describe("Reports shifts & cash-up (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    const make = async (first: string) => (await prisma.user.create({ data: { firstName: first, lastName: "Shifts", email: `${first.toLowerCase()}-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    user.ada = await make("Ada");
    user.tayo = await make("Tayo");
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantClockInOut: true }, update: { restaurantServiceChargePercent: 0, restaurantClockInOut: true, restaurantCashVarianceLimit: 500 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Shifts check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Shifts check" }, select: { id: true } })).id;
    dish = (await prisma.product.create({ data: { name: "RSH Rice", code: `RSH-${Date.now()}`, price: "500.00", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: dish, warehouseId, quantity: 100 } });
    await prisma.device.create({ data: { id: till, name: "Shifts till" } });

    // Ada's shift: a ₦1,000 bill settled in cash at the till; a ₦500 cash
    // refund on it; one table left open, handed to Tayo when she clocks out.
    assert.ok((await startShift(user.ada, till, new Date(Date.now() - 4 * 3600_000))).ok);
    const opened = await openTill({ deviceId: till, float: new Decimal("5000") }, user.ada);
    assert.ok(opened.ok);
    session = opened.id;
    const paid = await sent(user.ada);
    const done = await settleOrder({ orderId: paid, version: await versionOf(paid), payments: [{ paymentType: "CASH", amount: "1000" }], tip: "0", idempotencyKey: randomUUID() }, user.ada, { deviceId: till });
    assert.ok(done.ok, JSON.stringify(done));
    const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: paid }, select: { saleId: true } })).saleId!;
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId }, select: { id: true } });
    assert.ok((await refundOrder({ orderId: paid, lines: [{ saleItemId: line.id, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: false, idempotencyKey: randomUUID() }, user.ada, { deviceId: till })).ok);
    await sent(user.ada);
    assert.ok((await startShift(user.tayo, till, new Date(Date.now() - 3600_000))).ok);
    const ended = await endShift(user.ada, till, new Date(), { transferTo: user.tayo });
    assert.ok(ended.ok, JSON.stringify(ended));

    // The drawer opened once by hand while the till was open (a printer and
    // its job on this copy only).
    const printer = await prisma.printer.create({ data: { name: "Shifts check printer", connection: "NETWORK", address: "10.0.0.250:9100" }, select: { id: true } });
    // Each drawer kick is its own print job.
    for (const reason of ["MANUAL", "TEST"] as const) {
      const job = await prisma.printJob.create({ data: { printerId: printer.id, type: "DRAWER", label: "Drawer", template: "DRAWER", data: {} }, select: { id: true } });
      await prisma.drawerEvent.create({ data: { businessId: "default", reason, printerId: printer.id, printJobId: job.id, deviceId: till, userId: user.ada } });
    }

    // Expected ₦5,500 (5,000 float + 1,000 − 500); counted ₦4,900: ₦600 short, past the ₦500 limit.
    const closed = await closeTill({ deviceId: till, sessionId: session, counted: new Decimal("4900"), note: "short" }, user.ada);
    assert.ok(closed.ok, JSON.stringify(closed));
  });
  after(() => prisma.$disconnect());

  const report = async (f: Partial<ReportFilters> = {}) => {
    const result = await getShiftsReport(parseReportFilters({}, { dayStartMinutes: 0 }).window, { area: null, waiter: null, type: null, station: null, device: null, ...f });
    assert.ok(result.ok);
    return result.data;
  };

  test("shifts: hours, the bills settled on it (net of refunds made then), the handover", async () => {
    const data = await report({ waiter: user.ada });
    const { lines } = shiftLines(data.shifts);
    assert.equal(lines.length, 1);
    const [ada] = lines;
    assert.deepEqual([ada.orders, ada.net, ada.handedOver, ada.handedTo, ada.endedAt !== null], [1, "500.00", 1, "Tayo Shifts", true]);
    assert.ok(Math.abs(ada.seconds - 4 * 3600) < 120, "about four hours");
    const tayo = shiftLines((await report({ waiter: user.tayo })).shifts).lines[0];
    assert.deepEqual([tayo.endedAt, tayo.orders], [null, 0], "still on");
  });

  test("cash-up: as counted; drawer opens (not printer tests); red past the limit", async () => {
    const data = await report({ device: till });
    const { lines } = tillLines(data.tills, data.varianceLimit);
    assert.equal(lines.length, 1);
    const [t] = lines;
    assert.deepEqual([t.float.toString(), t.cashSales.toString(), t.cashRefunds.toString(), t.expected, t.counted?.toString(), t.variance, t.overLimit], ["5000", "1000", "500", "5500.00", "4900", "-600.00", true]);
    assert.deepEqual([t.drawerOpens, t.drawerByHand, t.device, t.open], [1, 1, "Shifts till", false]);
    assert.equal(data.varianceLimit.toString(), "500");
  });

  test("the Z-report reprint: refused with no receipt printer; with one, a job on the print queue, marked a reprint", async () => {
    const refused = await printZReport({ deviceId: till, sessionId: session }, user.ada);
    assert.deepEqual(refused, { ok: false, error: "This till has no receipt printer. Set one up in Settings › Printers." });
    // A receipt printer on this copy only (the business's print bridge watches its own database, not this one).
    const printer = await prisma.printer.create({ data: { name: "Shifts receipt", connection: "NETWORK", address: "10.0.0.251:9100" }, select: { id: true } });
    await prisma.printerAssignment.create({ data: { businessId: "default", role: "RECEIPT", printerId: printer.id } });
    const first = await printZReport({ deviceId: till, sessionId: session }, user.ada);
    const again = await printZReport({ deviceId: till, sessionId: session }, user.ada);
    assert.deepEqual([first.ok, again.ok && again.reprint], [true, true]);
    const jobs = await prisma.printJob.findMany({ where: { printerId: printer.id, template: "ZREPORT", refId: session }, select: { type: true } });
    assert.deepEqual(jobs.map((j) => j.type), ["REPORT", "REPORT"]);
    assert.ok((await prisma.tillSession.findUniqueOrThrow({ where: { id: session }, select: { zPrintedAt: true } })).zPrintedAt);
  });
});
