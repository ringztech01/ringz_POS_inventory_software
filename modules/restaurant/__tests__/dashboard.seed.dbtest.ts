// The Restaurant Dashboard against the seed data (modules/restaurant/seed.ts):
// bills three of the seeded orders (a Sale each, linked by saleId, as
// billing will), cancels a line, then checks every widget against a manual
// SQL query — and the revenue against the Sales list. Run on a throwaway
// copy after the seed (and with no other orders):
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/dashboard.seed.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { getSaleList } from "@/app/(dashboard)/sales/queries";
import { periodBounds, resolvePeriod } from "../lib/dashboard";
import { orderTotals } from "../lib/orderTotals";
import {
  getCancelledLines,
  getFloorNow,
  getLowStockIngredients,
  getOpenOrders,
  getOrderKpis,
  getOrderTypeMix,
  getPrepTime,
  getRevenue,
  getSalesByHour,
  getTopDishes,
} from "../server/queries/dashboard";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const now = new Date();
const period = resolvePeriod("today", now);
const { start, end } = periodBounds(period.range);
const today = new Date(`${period.range.from}T00:00:00.000Z`);
const dec = (value: Prisma.Decimal | string | number | null) => new Prisma.Decimal(value ?? 0).toFixed(2);

describe("restaurant dashboard on the seed data (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const seeded = await prisma.order.count({ where: { deletedAt: null } });
    assert.equal(seeded, 8, "run the seed on a copy with no orders first");

    // Bill T4, B1 (both Served) and the takeaway, as billing will.
    const { restaurantServiceChargePercent } = await getBusinessSettings();
    const user = await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const customer = await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const toBill = await prisma.order.findMany({
      where: { OR: [{ table: { name: { in: ["T4", "B1"] } } }, { type: "TAKEAWAY" }] },
      select: {
        id: true,
        warehouseId: true,
        items: { select: { quantity: true, unitPrice: true, taxType: true, taxRate: true, cancelledAt: true, deletedAt: true } },
      },
    });
    assert.equal(toBill.length, 3);
    for (const [i, order] of toBill.entries()) {
      const total = orderTotals(order.items, restaurantServiceChargePercent).total.toFixed(2);
      const sale = await prisma.sale.create({
        data: { reference: `RSEED-${i + 1}`, customerId: customer.id, warehouseId: order.warehouseId, date: today, status: "RECEIVED", grandTotal: total, paid: total, due: "0", createdById: user.id },
        select: { id: true },
      });
      await prisma.order.update({ where: { id: order.id }, data: { saleId: sale.id, status: "BILLED", closedAt: new Date() } });
    }
    // A cancelled line on T11 (its Chapman, sent).
    const chapman = await prisma.orderItem.findFirstOrThrow({ where: { order: { table: { name: "T11" } }, product: { name: "Chapman" } }, select: { id: true } });
    await prisma.orderItem.update({ where: { id: chapman.id }, data: { cancelledAt: new Date(), cancelReason: "Check" } });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("Revenue = manual SQL = the Sales list (same sales, same day)", async () => {
    const revenue = await getRevenue(period);
    const [sql] = await prisma.$queryRaw<{ total: Prisma.Decimal | null; bills: bigint }[]>`
      SELECT SUM(s.grandTotal) AS total, COUNT(*) AS bills FROM Sale s JOIN \`Order\` o ON o.saleId = s.id
      WHERE s.deletedAt IS NULL AND s.status = 'RECEIVED' AND s.date = ${today}`;
    const list = await getSaleList({ q: "RSEED-", from: period.range.from, to: period.range.to });
    assert.equal(revenue.current.revenue, dec(sql.total));
    assert.equal(revenue.current.bills, Number(sql.bills));
    assert.equal(revenue.current.revenue, dec(list.totals.grandTotal));
    assert.equal(revenue.current.bills, list.total);
    assert.ok(Number(revenue.current.revenue) > 0);
    console.log(`      revenue ${revenue.current.revenue} over ${revenue.current.bills} bills`);
  });

  test("Orders and Covers = manual SQL", async () => {
    const [sql] = await prisma.$queryRaw<{ orders: bigint; covers: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS orders, SUM(guests) AS covers FROM \`Order\`
      WHERE deletedAt IS NULL AND status <> 'CANCELLED' AND openedAt >= ${start} AND openedAt < ${end}`;
    const kpis = await getOrderKpis(period);
    assert.deepEqual(kpis.current, { orders: Number(sql.orders), covers: Number(sql.covers) });
    assert.deepEqual(kpis.current, { orders: 8, covers: 22 });
  });

  test("Tables occupied = manual SQL (8 orders less the 3 billed, less 2 without a table)", async () => {
    const [sql] = await prisma.$queryRaw<{ total: bigint; occupied: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS total,
             SUM(EXISTS (SELECT 1 FROM \`Order\` o WHERE o.activeTableId = t.id)) AS occupied
      FROM \`Table\` t JOIN DiningArea a ON a.id = t.areaId
      WHERE t.deletedAt IS NULL AND a.deletedAt IS NULL`;
    const floor = await getFloorNow();
    assert.deepEqual(floor, { occupied: Number(sql.occupied), total: Number(sql.total) });
    assert.equal(floor.occupied, 4);
    console.log(`      ${floor.occupied} / ${floor.total} tables`);
  });

  test("Open orders = manual SQL; the list starts with the oldest", async () => {
    const [sql] = await prisma.$queryRaw<{ open: bigint; served: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS open, SUM(status = 'SERVED') AS served FROM \`Order\`
      WHERE deletedAt IS NULL AND status IN ('OPEN', 'SENT', 'SERVED')`;
    const open = await getOpenOrders(now);
    assert.equal(open.count, Number(sql.open));
    assert.equal(open.waitingForBill, Number(sql.served ?? 0));
    assert.deepEqual(open.rows.map((r) => r.badge), ["T7", "T11", "T2", "P2", "DL"]);
  });

  test("Avg prep time = manual SQL (the seed's ready dishes took 12 minutes)", async () => {
    const [sql] = await prisma.$queryRaw<{ seconds: Prisma.Decimal | null }[]>`
      SELECT AVG(TIMESTAMPDIFF(SECOND, sentAt, readyAt)) AS seconds FROM OrderItem
      WHERE readyAt >= ${start} AND readyAt < ${end} AND cancelledAt IS NULL AND deletedAt IS NULL`;
    const prep = await getPrepTime(period);
    assert.equal(prep.current, Number(sql.seconds));
    assert.equal(Math.round(prep.current ?? 0), 720);
  });

  test("Cancelled lines = manual SQL", async () => {
    const [sql] = await prisma.$queryRaw<{ count: bigint; value: Prisma.Decimal | null }[]>`
      SELECT COUNT(*) AS count, SUM(unitPrice * quantity) AS value FROM OrderItem
      WHERE cancelledAt >= ${start} AND cancelledAt < ${end} AND deletedAt IS NULL`;
    const cancelled = await getCancelledLines(period);
    assert.deepEqual(cancelled.current, { count: Number(sql.count), value: dec(sql.value) });
    assert.equal(cancelled.current.count, 1);
  });

  test("Sales by hour and Order type mix add up to Revenue", async () => {
    const revenue = (await getRevenue(period)).current.revenue;
    const hours = await getSalesByHour(period, now);
    const mix = await getOrderTypeMix(period);
    const sum = (values: string[]) => values.reduce((total, v) => total.plus(v), new Prisma.Decimal(0)).toFixed(2);
    assert.equal(sum(hours.map((h) => h.total)), revenue);
    assert.equal(sum(mix.map((m) => m.amount)), revenue);
    assert.deepEqual(mix.map((m) => [m.type, m.orders]), [["DINE_IN", 6], ["TAKEAWAY", 1], ["DELIVERY", 1]]);
  });

  test("Top dishes = manual SQL over the billed orders", async () => {
    const sql = await prisma.$queryRaw<{ name: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal }[]>`
      SELECT p.name, SUM(i.quantity) AS quantity, SUM(i.unitPrice * i.quantity) AS revenue
      FROM OrderItem i JOIN \`Order\` o ON o.id = i.orderId JOIN Sale s ON s.id = o.saleId JOIN Product p ON p.id = i.productId
      WHERE s.deletedAt IS NULL AND s.status = 'RECEIVED' AND s.date = ${today} AND i.cancelledAt IS NULL AND i.deletedAt IS NULL
      GROUP BY p.id, p.name ORDER BY quantity DESC, revenue DESC, p.name ASC LIMIT 5`;
    const dishes = await getTopDishes(period);
    assert.deepEqual(
      dishes.map((d) => [d.name, d.quantity, d.revenue]),
      sql.map((r) => [r.name, Number(r.quantity), dec(r.revenue)]),
    );
    assert.equal(dishes[0].name, "Chapman");
  });

  test("Low-stock ingredients = manual SQL — the design's five", async () => {
    const sql = await prisma.$queryRaw<{ name: string }[]>`
      SELECT p.name FROM ProductStock ps JOIN Product p ON p.id = ps.productId
      WHERE p.productType = 'INGREDIENT' AND p.deletedAt IS NULL AND p.stockAlert IS NOT NULL AND ps.quantity <= p.stockAlert
        AND ps.warehouseId IN (SELECT warehouseId FROM DiningArea WHERE deletedAt IS NULL)
      ORDER BY p.name`;
    const low = await getLowStockIngredients();
    assert.deepEqual(low.rows.map((r) => r.name).sort(), sql.map((r) => r.name));
    assert.deepEqual(
      low.rows.map((r) => [r.name, `${r.quantity} ${r.unit}`, r.level]),
      [
        ["Grenadine syrup", "0 L", "Critical"],
        ["Chicken thighs", "3 kg", "Critical"],
        ["Basmati rice", "6 kg", "Low"],
        ["Tilapia (whole)", "8 pc", "Low"],
        ["Plantain", "14 pc", "Low"],
      ],
    );
  });
});
