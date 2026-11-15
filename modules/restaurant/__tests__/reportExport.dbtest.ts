// Restaurant Reports, Step 10, against a real database (a throwaway copy):
// the Excel export of every tab — bills settled the real way, a void and a
// refund — read back from the .xlsx: the header rows, the numbers as real
// numbers matching the report's own figures, cost and margin only with View
// Cost, the on-screen sort, and the streamed workbook the same as the whole
// one. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportExport.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { buildWorkbook, workbookStream } from "@/lib/reports/exportXlsx";
import { cells, unzip } from "@/lib/reports/xlsxRead.test-util";
import { newQrToken } from "../lib/qrToken";
import { REPORT_TABS, type ReportTabKey } from "../lib/reportTabs";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { cancelLine, sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { refundOrder } from "../server/services/refund";
import { parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { getReportSetup } from "../server/queries/reports/shell";
import { getOverview } from "../server/queries/reports/overview";
import { buildReportExport, type ExportContext } from "../server/reportExport";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const DAY = "2025-12-03";
const at = (hhmm: string) => new Date(`2025-12-03T${hhmm}:00.000Z`);
const NOW = new Date("2026-11-13T09:00:00.000Z");
const user: Record<"ada" | "bola", string> = { ada: "", bola: "" };
let areaId = "";
const dish: Record<"rice" | "soup", string> = { rice: "", soup: "" };
let n = 0;
const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;

async function bill(waiterId: string, products: string[]) {
  n += 1;
  const table = await prisma.table.create({ data: { name: testTable(`RX${n}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, waiterId);
  assert.ok(opened.ok);
  for (const [i, productId] of products.entries()) assert.ok((await addLine({ orderId: opened.orderId, version: await versionOf(opened.orderId), productId, modifierIds: [], note: i ? `p${i}` : null })).ok);
  assert.ok((await sendToKitchen(opened.orderId, await versionOf(opened.orderId), waiterId)).ok);
  return opened.orderId;
}
async function settle(orderId: string, waiterId: string, closedAt: Date) {
  const done = await settleOrder({ orderId, version: await versionOf(orderId), payments: [{ paymentType: "CASH", amount: "500" }], tip: "0", idempotencyKey: randomUUID() }, waiterId);
  assert.ok(done.ok, JSON.stringify(done));
  await prisma.order.update({ where: { id: orderId }, data: { closedAt } });
}

let setup: Awaited<ReturnType<typeof getReportSetup>>;
const mine = (): ReportFilters => ({ area: areaId, waiter: null, type: null, station: null, device: null });
const window = () => parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window;
const ctx = (tab: ReportTabKey, extra: Partial<ExportContext> = {}): ExportContext => {
  assert.ok(setup.ok);
  return { tab, window: window(), filters: mine(), params: new URLSearchParams(), setup: setup.data, withCost: true, canAudit: true, clockInOut: true, business: "Check kitchen", generatedBy: "Ada Export", now: NOW, ...extra };
};
async function read(c: ExportContext) {
  const book = await buildReportExport(c);
  assert.ok(book.ok, JSON.stringify(book));
  const files = unzip(await buildWorkbook(book.data.sheets, { utcOffsetMinutes: 60, now: NOW }));
  const names = [...files.get("xl/workbook.xml")!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const sheet = (name: string) => {
    const xml = files.get(`xl/worksheets/sheet${names.indexOf(name) + 1}.xml`)!;
    const all = cells(xml);
    const rows = new Map<number, Map<string, (typeof all)[number]>>();
    for (const c of all) {
      const r = Number(c.ref.replace(/^[A-Z]+/, ""));
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r)!.set(c.ref.replace(/\d+$/, ""), c);
    }
    return { xml, rows, headers: [...(rows.get(8)?.values() ?? [])].map((c) => c.value) };
  };
  return { book: book.data, names, sheet };
}

describe("Reports export (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    const make = async (first: string) => (await prisma.user.create({ data: { firstName: first, lastName: "Export", email: `${first.toLowerCase()}-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    user.ada = await make("Ada");
    user.bola = await make("Bola");
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: { restaurantServiceChargePercent: 0 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: `Export check ${Date.now()}`, warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Export check" }, select: { id: true } })).id;
    const make2 = async (name: string, price: string, cost: string) => {
      const p = await prisma.product.create({ data: { name, code: `RX-${name}-${Date.now()}`, price, cost, orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 100 } });
      return p.id;
    };
    dish.rice = await make2("RX Rice", "100.00", "40.00");
    dish.soup = await make2("RX Soup", "50.00", "15.00");
    // Ada: ₦250 (2 rice, 1 soup); Bola: ₦100 (1 rice), one soup voided first. A soup refunded.
    const a = await bill(user.ada, [dish.rice, dish.rice, dish.soup]);
    await settle(a, user.ada, at("12:00"));
    const b = await bill(user.bola, [dish.rice, dish.soup]);
    const soup = await prisma.orderItem.findFirstOrThrow({ where: { orderId: b, productId: dish.soup }, select: { id: true } });
    assert.ok((await cancelLine({ orderId: b, lineId: soup.id, version: await versionOf(b), reason: "WRONG_ITEM", details: null }, user.bola, { mayVoid: true })).ok);
    await prisma.orderItem.update({ where: { id: soup.id }, data: { cancelledAt: at("12:50") } });
    await settle(b, user.bola, at("13:00"));
    const saleId = (await prisma.order.findUniqueOrThrow({ where: { id: a }, select: { saleId: true } })).saleId!;
    const line = await prisma.saleItem.findFirstOrThrow({ where: { saleId, productId: dish.soup }, select: { id: true } });
    assert.ok((await refundOrder({ orderId: a, lines: [{ saleItemId: line.id, quantity: 1 }], paymentType: "CASH", reason: "Cold", returnToStock: false, idempotencyKey: randomUUID() }, user.ada)).ok);
    await prisma.saleReturn.updateMany({ where: { saleId }, data: { createdAt: at("15:00") } });
    setup = await getReportSetup();
  });
  after(() => prisma.$disconnect());

  test("every tab exports; each sheet starts with the business, report, period, filters, who and when", async () => {
    for (const t of REPORT_TABS) {
      const { book, names, sheet } = await read(ctx(t.key));
      assert.ok(book.filename.startsWith("Restaurant-") && book.filename.endsWith(`${DAY}.xlsx`), book.filename);
      assert.ok(names.length >= 1, t.key);
      const first = sheet(names[0]).rows;
      const label = (r: number) => first.get(r)?.get("A")?.value;
      assert.deepEqual([1, 2, 3, 4, 5, 6].map(label), ["Business", "Report", "Period", "Filters", "Generated by", "Generated at"], t.key);
      assert.equal(first.get(1)?.get("B")?.value, "Check kitchen");
      assert.match(first.get(2)?.get("B")?.value ?? "", new RegExp(`Restaurant Reports · ${t.label.replace("&", "&amp;")}`));
      assert.match(first.get(4)?.get("B")?.value ?? "", /^Dining area: Export check/);
      assert.equal(first.get(6)?.get("B")?.style, "7", "a real date-time cell");
    }
  });

  test("Overview: net sales a number, the same as the report", async () => {
    const { sheet } = await read(ctx("overview"));
    const summary = sheet("Summary").rows;
    const net = [...summary.values()].find((r) => r.get("A")?.value === "Net sales")!;
    const overview = await getOverview(window(), mine(), { dayStartMinutes: 0, withCost: true });
    assert.ok(overview.ok);
    assert.deepEqual([net.get("B")?.value, net.get("B")?.style], [overview.data.current.net.toFixed(2), "2"]);
    assert.equal(overview.data.current.net.toFixed(2), "300.00", "₦350 of bills − ₦50 refunded");
    const byDay = sheet("Sales by day").rows;
    assert.deepEqual([byDay.get(9)?.get("A")?.style, byDay.get(9)?.get("B")?.value], ["6", "300.00"], "a real date, then the day's net");
  });

  test("By dish: cost and margin with View Cost only; totals match", async () => {
    const withCost = (await read(ctx("dishes"))).sheet("By dish");
    assert.ok(withCost.headers.includes("Food cost") && withCost.headers.includes("Margin"));
    const without = (await read(ctx("dishes", { withCost: false }))).sheet("By dish");
    assert.ok(!without.headers.some((h) => /cost|margin/i.test(h)), without.headers.join("|"));
    const total = [...withCost.rows.values()].find((r) => r.get("A")?.value === "Total")!;
    const col = (name: string) => String.fromCharCode(65 + withCost.headers.indexOf(name));
    // Rice 3 × ₦100; soup ₦50 less ₦50 refunded. Cost: 3 × 40 + 1 × 15.
    assert.deepEqual([total.get(col("Qty sold"))?.value, total.get(col("Net sales"))?.value, total.get(col("Food cost"))?.value], ["4", "300.00", "135.00"]);
  });

  test("the on-screen sort: By waiter by name, A→Z", async () => {
    const sorted = (await read(ctx("waiters", { params: new URLSearchParams("sort=name&dir=asc") }))).sheet("By waiter").rows;
    assert.deepEqual([sorted.get(9)?.get("A")?.value, sorted.get(10)?.get("A")?.value], ["Ada Export", "Bola Export"]);
    const byNet = (await read(ctx("waiters"))).sheet("By waiter").rows;
    assert.deepEqual([byNet.get(9)?.get("A")?.value, byNet.get(9)?.get("D")?.value], ["Ada Export", "200.00"], "net sales, largest first");
  });

  test("lists: all their rows (not the screen's 500); over the threshold, streamed — the same rows", async () => {
    const whole = await read(ctx("voids"));
    assert.equal(whole.book.stream, false);
    const voids = whole.sheet("Voids").rows;
    assert.deepEqual([voids.get(9)?.get("A")?.style, voids.get(9)?.get("D")?.value, voids.get(9)?.get("F")?.value], ["7", "RX Soup", "50"]);
    const big = await buildReportExport(ctx("voids", { streamAbove: 0 }));
    assert.ok(big.ok && big.data.stream);
    const chunks: Uint8Array[] = [];
    const reader = workbookStream(big.data.sheets, { utcOffsetMinutes: 60, now: NOW }).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const streamed = unzip(Buffer.concat(chunks));
    const rowsOf = (xml: string) => cells(xml).filter((c) => Number(c.ref.replace(/^[A-Z]+/, "")) === 9).map((c) => c.value);
    assert.deepEqual(rowsOf(streamed.get("xl/worksheets/sheet2.xml")!), rowsOf(whole.sheet("Voids").xml));
    const refunds = await buildReportExport(ctx("payments", { streamAbove: 0 }));
    assert.ok(refunds.ok && refunds.data.stream);
  });
});
