// The Restaurant Dashboard's queries (server/queries/dashboard.ts) against a
// real database: the empty case, then a day of orders and sales built to
// hit every rule (cancelled lines, soft-deleted and unbilled sales, deleted
// orders, last week's figures). It CLEARS the restaurant's data first, so
// it needs a throwaway copy and refuses to run anywhere else:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/dashboard.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma, type OrderStatus, type OrderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { getSaleList } from "@/app/(dashboard)/sales/queries";
import { resolvePeriod } from "../lib/dashboard";
import { newQrToken } from "../lib/qrToken";
import { orderTotals } from "../lib/orderTotals";
import {
  getCancelledLines,
  getFloorNow,
  getLowStockIngredients,
  getOpenOrders,
  getOrderKpis,
  getOrderTypeMix,
  getPrepTime,
  getRestaurantWarehouses,
  getRevenue,
  getSalesByHour,
  getTopDishes,
} from "../server/queries/dashboard";
import { loadWidget } from "../server/safely";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Wed 10 Jun 2026, 12:00 in Lagos; last week is Wed 3 Jun.
const NOW = new Date("2026-06-10T11:00:00.000Z");
const TODAY = resolvePeriod("today", NOW);
const at = (iso: string) => new Date(iso);
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

let warehouseId = "";
let warehouseName = "";
let userId = "";
let customerId = "";
const dish: Record<"jollof" | "chapman", string> = { jollof: "", chapman: "" };

async function clearRestaurant() {
  await prisma.reservation.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.table.deleteMany({});
  await prisma.diningArea.deleteMany({});
}

async function sale(reference: string, grandTotal: string, date: string, createdAt: Date, extra: Partial<Prisma.SaleUncheckedCreateInput> = {}) {
  return prisma.sale.create({
    data: { reference, customerId, warehouseId, date: day(date), status: "RECEIVED", grandTotal, due: grandTotal, createdById: userId, createdAt, ...extra },
    select: { id: true },
  });
}

type Line = { product: "jollof" | "chapman"; quantity: number; price: string; sentAt?: Date; readyAt?: Date; cancelledAt?: Date; deletedAt?: Date };
async function order(o: { type?: OrderType; status: OrderStatus; tableId?: string; guests: number; openedAt: Date; saleId?: string; deletedAt?: Date; lines?: Line[] }) {
  return prisma.order.create({
    data: {
      type: o.type ?? "DINE_IN",
      status: o.status,
      tableId: o.tableId ?? null,
      warehouseId,
      waiterId: userId,
      guests: o.guests,
      openedAt: o.openedAt,
      saleId: o.saleId ?? null,
      deletedAt: o.deletedAt ?? null,
      items: {
        create: (o.lines ?? []).map((line) => ({
          productId: dish[line.product],
          quantity: line.quantity,
          unitPrice: line.price,
          kitchenStatus: line.readyAt ? "READY" : line.sentAt ? "PENDING" : "NEW",
          sentAt: line.sentAt ?? null,
          readyAt: line.readyAt ?? null,
          cancelledAt: line.cancelledAt ?? null,
          deletedAt: line.deletedAt ?? null,
        })),
      },
    },
    select: { id: true },
  });
}

// No database needed: a widget whose query throws becomes { ok: false } (the
// page shows that widget's error and the rest), and is logged.
test("a failing widget is contained: { ok: false }, logged; a working one passes its data through", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.deepEqual(await loadWidget("broken", Promise.reject(new Error("DB down"))), { ok: false });
    assert.deepEqual(await loadWidget("fine", Promise.resolve({ revenue: "1.00" })), { ok: true, data: { revenue: "1.00" } });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(String((logged[0] as unknown[])[0]), /dashboard widget "broken" failed/);
});

describe("restaurant dashboard (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true, name: true } });
    warehouseId = warehouse.id;
    warehouseName = warehouse.name;
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    customerId = (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await clearRestaurant();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("empty: every tile is 0 / ₦0.00 and every list is empty", async () => {
    const [revenue, orders, floor, open, prep, cancelled, hours, mix, dishes, low, warehouses] = await Promise.all([
      getRevenue(TODAY),
      getOrderKpis(TODAY),
      getFloorNow(),
      getOpenOrders(NOW),
      getPrepTime(TODAY),
      getCancelledLines(TODAY),
      getSalesByHour(TODAY, NOW),
      getOrderTypeMix(TODAY),
      getTopDishes(TODAY),
      getLowStockIngredients(),
      getRestaurantWarehouses(),
    ]);
    assert.deepEqual(revenue, { current: { revenue: "0.00", bills: 0 }, previous: { revenue: "0.00", bills: 0 } });
    assert.deepEqual(orders, { current: { orders: 0, covers: 0 }, previous: { orders: 0, covers: 0 } });
    assert.deepEqual(floor, { occupied: 0, total: 0 });
    assert.deepEqual(open, { count: 0, waitingForBill: 0, rows: [] });
    assert.deepEqual(prep, { current: null, previous: null });
    assert.deepEqual(cancelled, { current: { count: 0, value: "0.00" }, previous: { count: 0, value: "0.00" } });
    assert.deepEqual(hours, []);
    assert.deepEqual(mix, [
      { type: "DINE_IN", orders: 0, amount: "0.00" },
      { type: "TAKEAWAY", orders: 0, amount: "0.00" },
      { type: "DELIVERY", orders: 0, amount: "0.00" },
    ]);
    assert.deepEqual(dishes, []);
    assert.deepEqual(low, { rows: [], total: 0 });
    assert.deepEqual(warehouses, []);
  });

  describe("a day of orders and sales", () => {
    let o5 = "";
    before(async () => {
      const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
      const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
      const categoryId = (await prisma.category.create({ data: { name: "Dashboard check" }, select: { id: true } })).id;
      const product = (name: string, data: Partial<Prisma.ProductUncheckedCreateInput>) =>
        prisma.product.create({
          data: { name, code: `DB-${name}-${Date.now()}`, price: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", ...data },
          select: { id: true },
        });
      dish.jollof = (await product("Check Jollof", { productType: "MENU_ITEM", price: "18" })).id;
      dish.chapman = (await product("Check Chapman", { productType: "MENU_ITEM", price: "6" })).id;

      // Ingredients: two low here, one fine, one deleted; a low STANDARD
      // product; and one low in a warehouse the restaurant doesn't use.
      const other = await prisma.warehouse.create({
        data: { name: "Dashboard other", email: "x@example.com", phoneNumber: "0", country: "NG", city: "Lagos", zipCode: "0" },
        select: { id: true },
      });
      for (const [name, data, quantity, where] of [
        ["Check Rice", { productType: "INGREDIENT", stockAlert: 10 }, 4, warehouseId],
        ["Check Pepper", { productType: "INGREDIENT", stockAlert: 10 }, 7, warehouseId],
        ["Check Salt", { productType: "INGREDIENT", stockAlert: 5 }, 9, warehouseId],
        ["Check Gone", { productType: "INGREDIENT", stockAlert: 10, deletedAt: new Date() }, 1, warehouseId],
        ["Check Retail", { productType: "STANDARD", stockAlert: 10 }, 1, warehouseId],
        ["Check Elsewhere", { productType: "INGREDIENT", stockAlert: 10 }, 1, other.id],
      ] as const) {
        const { id } = await product(name, data);
        await prisma.productStock.create({ data: { productId: id, warehouseId: where, quantity } });
      }

      const area = await prisma.diningArea.create({ data: { name: "Dashboard hall", warehouseId }, select: { id: true } });
      const table = (name: string, deletedAt: Date | null = null) =>
        prisma.table.create({ data: { name, seats: 4, areaId: area.id, qrToken: newQrToken(), deletedAt }, select: { id: true } }).then((t) => t.id);
      const [a1, a2, a3] = [await table("A1"), await table("A2"), await table("A3")];
      await table("A4", new Date());

      // Billed today (counted): 13:15 and 10:40 Lagos.
      const s1 = await sale("RDB-OK-1", "120.00", "2026-06-10", at("2026-06-10T12:15:00.000Z"));
      const s2 = await sale("RDB-OK-2", "54.50", "2026-06-10", at("2026-06-10T09:40:00.000Z"));
      // Not counted: soft-deleted, pending, not linked to an order, tomorrow's.
      const s3 = await sale("RDB-DEL-1", "999.00", "2026-06-10", at("2026-06-10T12:00:00.000Z"), { deletedAt: new Date() });
      const s4 = await sale("RDB-PEND-1", "77.00", "2026-06-10", at("2026-06-10T12:00:00.000Z"), { status: "PENDING" });
      await sale("RDB-RETAIL-1", "500.00", "2026-06-10", at("2026-06-10T12:00:00.000Z"));
      const s9 = await sale("RDB-OK-9", "300.00", "2026-06-11", at("2026-06-11T12:00:00.000Z"));
      // Last week.
      const s0 = await sale("RDB-OK-0", "100.00", "2026-06-03", at("2026-06-03T12:00:00.000Z"));

      await order({
        status: "BILLED", tableId: a1, guests: 4, openedAt: minutesAgo(180), saleId: s1.id,
        lines: [
          { product: "jollof", quantity: 3, price: "18.00", sentAt: at("2026-06-10T09:00:00.000Z"), readyAt: at("2026-06-10T09:14:00.000Z") },
          { product: "chapman", quantity: 2, price: "6.00", sentAt: at("2026-06-10T09:00:00.000Z") },
          { product: "chapman", quantity: 1, price: "6.00", sentAt: at("2026-06-10T09:00:00.000Z"), cancelledAt: at("2026-06-10T09:05:00.000Z") },
        ],
      });
      await order({
        type: "TAKEAWAY", status: "BILLED", guests: 1, openedAt: minutesAgo(130), saleId: s2.id,
        lines: [{ product: "jollof", quantity: 2, price: "18.00", sentAt: at("2026-06-10T09:00:00.000Z"), readyAt: at("2026-06-10T09:10:00.000Z") }],
      });
      await order({ status: "BILLED", tableId: a2, guests: 2, openedAt: minutesAgo(120), saleId: s3.id, lines: [{ product: "chapman", quantity: 5, price: "6.00" }] });
      await order({ type: "DELIVERY", status: "BILLED", guests: 1, openedAt: minutesAgo(110), saleId: s4.id, lines: [{ product: "chapman", quantity: 1, price: "6.00" }] });
      o5 = (
        await order({
          status: "SENT", tableId: a2, guests: 3, openedAt: minutesAgo(50),
          lines: [
            { product: "jollof", quantity: 1, price: "18.00", sentAt: minutesAgo(45) },
            { product: "jollof", quantity: 2, price: "18.00", sentAt: minutesAgo(45), cancelledAt: minutesAgo(40) },
            // Removed before sending: not a cancelled line.
            { product: "chapman", quantity: 4, price: "6.00", cancelledAt: minutesAgo(40), deletedAt: minutesAgo(40) },
          ],
        })
      ).id;
      await order({ status: "OPEN", tableId: a3, guests: 2, openedAt: minutesAgo(5) });
      await order({ type: "TAKEAWAY", status: "SERVED", guests: 1, openedAt: minutesAgo(20), lines: [{ product: "chapman", quantity: 1, price: "6.00", sentAt: minutesAgo(19) }] });
      // Merged away (cancelled) and deleted orders: not counted anywhere.
      await order({ status: "CANCELLED", guests: 2, openedAt: minutesAgo(90) });
      await order({
        status: "OPEN", guests: 9, openedAt: minutesAgo(30), deletedAt: new Date(),
        lines: [{ product: "jollof", quantity: 1, price: "18.00", sentAt: minutesAgo(29), readyAt: minutesAgo(1), cancelledAt: minutesAgo(10) }],
      });
      // Tomorrow's billed order (not today), and last week's.
      await order({ status: "BILLED", guests: 5, openedAt: at("2026-06-11T10:00:00.000Z"), saleId: s9.id, lines: [{ product: "jollof", quantity: 9, price: "18.00" }] });
      await order({
        status: "BILLED", guests: 2, openedAt: at("2026-06-03T10:00:00.000Z"), saleId: s0.id,
        lines: [
          { product: "jollof", quantity: 1, price: "18.00", sentAt: at("2026-06-03T10:00:00.000Z"), readyAt: at("2026-06-03T10:20:00.000Z") },
          { product: "chapman", quantity: 1, price: "6.00", sentAt: at("2026-06-03T10:00:00.000Z"), cancelledAt: at("2026-06-03T10:05:00.000Z") },
        ],
      });
    });

    test("revenue: billed, Received, not deleted, linked sales only — and it equals the Sales list for those sales", async () => {
      const revenue = await getRevenue(TODAY);
      assert.deepEqual(revenue, { current: { revenue: "174.50", bills: 2 }, previous: { revenue: "100.00", bills: 1 } });
      const list = await getSaleList({ q: "RDB-OK", from: "2026-06-10", to: "2026-06-10" });
      assert.equal(new Prisma.Decimal(list.totals.grandTotal).toFixed(2), revenue.current.revenue);
      assert.equal(list.total, revenue.current.bills);
      const [manual] = await prisma.$queryRaw<{ total: Prisma.Decimal }[]>`
        SELECT SUM(s.grandTotal) AS total FROM Sale s JOIN \`Order\` o ON o.saleId = s.id
        WHERE s.deletedAt IS NULL AND s.status = 'RECEIVED' AND s.date = ${day("2026-06-10")}`;
      assert.equal(new Prisma.Decimal(manual.total).toFixed(2), revenue.current.revenue);
    });

    test("Last 7 days runs Thu 4 → Wed 10 Jun (to the end of the day), against the 7 days before", async () => {
      const week = await getRevenue(resolvePeriod("7d", NOW));
      assert.deepEqual(week, { current: { revenue: "174.50", bills: 2 }, previous: { revenue: "100.00", bills: 1 } });
    });

    test("orders and covers: opened today, not cancelled or deleted", async () => {
      assert.deepEqual(await getOrderKpis(TODAY), { current: { orders: 7, covers: 14 }, previous: { orders: 1, covers: 2 } });
    });

    test("tables occupied now: tables on the floor holding an Open, Sent or Served order", async () => {
      assert.deepEqual(await getFloorNow(), { occupied: 2, total: 3 });
    });

    test("open orders now: oldest first, late after 45 minutes, totals from lib/pricing", async () => {
      const open = await getOpenOrders(NOW);
      const { restaurantServiceChargePercent } = await getBusinessSettings();
      const o5Lines = await prisma.orderItem.findMany({ where: { orderId: o5 }, select: { quantity: true, unitPrice: true, taxType: true, taxRate: true, cancelledAt: true, deletedAt: true } });
      assert.equal(open.count, 3);
      assert.equal(open.waitingForBill, 1);
      assert.deepEqual(
        open.rows.map((r) => [r.badge, r.guests, r.status, r.time, r.late]),
        [
          ["A2", 3, "In kitchen", "50m", true],
          ["TA", 1, "Served · ready to bill", "20m", false],
          ["A3", 2, "Ordering", "5m", false],
        ],
      );
      assert.equal(open.rows[0].total, formatNaira(orderTotals(o5Lines, restaurantServiceChargePercent).total.toFixed(2)));
      assert.equal(open.rows[2].total, "₦0.00");
    });

    test("avg prep time: Sent → Ready over the dishes ready in the period", async () => {
      assert.deepEqual(await getPrepTime(TODAY), { current: 720, previous: 1200 });
    });

    test("cancelled lines: count and value; removed lines and deleted orders left out", async () => {
      assert.deepEqual(await getCancelledLines(TODAY), { current: { count: 2, value: "42.00" }, previous: { count: 1, value: "6.00" } });
    });

    test("sales by hour (Lagos clock) adds up to revenue", async () => {
      assert.deepEqual(await getSalesByHour(TODAY, NOW), [
        { hour: 10, total: "54.50" },
        { hour: 13, total: "120.00" },
      ]);
    });

    test("order type mix: today's order counts, billed amounts (adding up to revenue)", async () => {
      assert.deepEqual(await getOrderTypeMix(TODAY), [
        { type: "DINE_IN", orders: 4, amount: "120.00" },
        { type: "TAKEAWAY", orders: 2, amount: "54.50" },
        { type: "DELIVERY", orders: 1, amount: "0.00" },
      ]);
    });

    test("top dishes: billed orders only, by quantity; cancelled lines left out", async () => {
      assert.deepEqual(
        (await getTopDishes(TODAY)).map((d) => [d.name, d.quantity, d.revenue]),
        [
          ["Check Jollof", 5, "90.00"],
          ["Check Chapman", 2, "12.00"],
        ],
      );
    });

    test("low-stock ingredients: in the restaurant's warehouse, at or below alert, Critical / Low", async () => {
      // (The copy may hold other ingredients, e.g. the seed's: only this
      // test's own are checked.)
      const low = await getLowStockIngredients();
      const ours = low.rows.filter((r) => r.name.startsWith("Check "));
      assert.ok(ours.every((r) => r.warehouseId === warehouseId), "each row carries its warehouse id (the Stock page link)");
      assert.deepEqual(
        ours.map((r) => [r.name, r.quantity, r.level, r.warehouse]),
        [
          ["Check Rice", 4, "Critical", warehouseName],
          ["Check Pepper", 7, "Low", warehouseName],
        ],
      );
      const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM ProductStock ps JOIN Product p ON p.id = ps.productId
        WHERE ps.warehouseId = ${warehouseId} AND p.productType = 'INGREDIENT' AND p.deletedAt IS NULL
          AND p.stockAlert IS NOT NULL AND ps.quantity <= p.stockAlert`;
      assert.equal(low.total, Number(total));
      assert.deepEqual(await getRestaurantWarehouses(), [warehouseName]);
    });

    test("a soft-deleted sale drops out at once", async () => {
      await prisma.sale.update({ where: { reference: "RDB-OK-2" }, data: { deletedAt: new Date() } });
      assert.deepEqual((await getRevenue(TODAY)).current, { revenue: "120.00", bills: 1 });
      assert.deepEqual(await getSalesByHour(TODAY, NOW), [{ hour: 13, total: "120.00" }]);
      assert.deepEqual((await getTopDishes(TODAY)).map((d) => [d.name, d.quantity]), [["Check Jollof", 3], ["Check Chapman", 2]]);
      assert.equal((await getOrderTypeMix(TODAY)).find((m) => m.type === "TAKEAWAY")?.amount, "0.00");
      await prisma.sale.update({ where: { reference: "RDB-OK-2" }, data: { deletedAt: null } });
    });
  });
});
