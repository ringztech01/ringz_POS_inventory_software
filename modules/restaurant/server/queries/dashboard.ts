import "server-only";
import { Prisma, type OrderStatus, type OrderType, type PurchaseStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import type { DateRange } from "@/lib/dateRanges";
import { formatNaira } from "@/lib/format";
import { saleListWhere } from "@/app/(dashboard)/sales/queries";
import {
  LATE_ORDER_MINUTES,
  NO_TABLE_BADGE,
  OPEN_ORDER_STATUS_LABEL,
  ORDER_TYPES,
  periodBounds,
  stockLevel,
  type DashboardPeriod,
  type StockLevel,
} from "../../lib/dashboard";
import { orderTotals } from "../../lib/orderTotals";
import { getPrepSummary } from "./prepTimes";
import { appZoneOffsetMinutes, formatOpenFor } from "../../lib/time";
import { TABLE_HOLDING_STATUSES } from "../../lib/tableStatus";

// The Restaurant Dashboard's queries: read-only, one function per widget,
// every sum aggregated in the database. Money leaves as 2dp strings.
//
// REVENUE RULE. Revenue is billed Sales only: linked to an Order (its
// saleId), counted by the retail dashboard's status rule (Received — this
// app's completed sale) and not soft-deleted, on the Sales list's own filter
// (saleListWhere: active rows, Sale.date in the range) and summed the way
// the list sums its totals (aggregate _sum grandTotal). So the Revenue tile
// equals the Sales list for the same sales and dates, and Sales by hour,
// the order type amounts and Top dishes all count the same sales.
//
// Orders, covers and the type counts are the orders opened in the range
// (not cancelled — a merged order is cancelled — and not deleted). "Now"
// widgets (tables occupied, open orders) ignore the date filter.

const COUNTED_SALE: { status: PurchaseStatus } = { status: "RECEIVED" };

const billedSales = (range: DateRange): Prisma.SaleWhereInput => ({
  ...saleListWhere({ from: range.from, to: range.to }),
  ...COUNTED_SALE,
  order: { isNot: null },
});

// The same sales in SQL (Sale.date is date-only, at UTC midnight — as
// lib/dashboard/queries.ts filters it).
function saleDays(range: DateRange) {
  return {
    from: new Date(`${range.from}T00:00:00.000Z`),
    toExclusive: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000),
  };
}
const billedSaleSql = (range: DateRange) => {
  const { from, toExclusive } = saleDays(range);
  return Prisma.sql`s.\`deletedAt\` IS NULL AND s.\`status\` = 'RECEIVED' AND s.\`date\` >= ${from} AND s.\`date\` < ${toExclusive}`;
};

const ordersOpenedIn = (range: DateRange): Prisma.OrderWhereInput => {
  const { start, end } = periodBounds(range);
  return { deletedAt: null, status: { not: "CANCELLED" }, openedAt: { gte: start, lt: end } };
};

const money = (value: Prisma.Decimal | string | number | null | undefined) => new Prisma.Decimal(value ?? 0).toFixed(2);

// ---- Revenue today, Average bill -------------------------------------------

export type RevenueFigures = { revenue: string; bills: number };
export type RevenueKpis = { current: RevenueFigures; previous: RevenueFigures };

export async function getRevenue(period: DashboardPeriod): Promise<RevenueKpis> {
  const [current, previous] = await Promise.all(
    [period.range, period.previous].map((range) =>
      prisma.sale.aggregate({ where: billedSales(range), _count: { _all: true }, _sum: { grandTotal: true } }),
    ),
  );
  const figures = (row: typeof current) => ({ revenue: money(row._sum.grandTotal), bills: row._count._all });
  return { current: figures(current), previous: figures(previous) };
}

// ---- Orders, Covers --------------------------------------------------------

export type OrderFigures = { orders: number; covers: number };
export type OrderKpis = { current: OrderFigures; previous: OrderFigures };

export async function getOrderKpis(period: DashboardPeriod): Promise<OrderKpis> {
  const [current, previous] = await Promise.all(
    [period.range, period.previous].map((range) =>
      prisma.order.aggregate({ where: ordersOpenedIn(range), _count: { _all: true }, _sum: { guests: true } }),
    ),
  );
  const figures = (row: typeof current) => ({ orders: row._count._all, covers: row._sum.guests ?? 0 });
  return { current: figures(current), previous: figures(previous) };
}

// ---- Tables occupied (now) -------------------------------------------------

export type FloorNow = { occupied: number; total: number };

// Tables on the floor (not deleted, in a live area) and those holding an
// Open, Sent or Served order — the floor plan's Occupied.
export async function getFloorNow(): Promise<FloorNow> {
  const onFloor: Prisma.TableWhereInput = { deletedAt: null, area: { deletedAt: null } };
  const [total, occupied] = await Promise.all([
    prisma.table.count({ where: onFloor }),
    prisma.table.count({ where: { ...onFloor, orders: { some: { deletedAt: null, status: { in: [...TABLE_HOLDING_STATUSES] } } } } }),
  ]);
  return { occupied, total };
}

// ---- Open orders (now): the tile and the live list -------------------------

export type OpenOrderRow = {
  id: string;
  badge: string;
  waiter: string;
  guests: number;
  status: string;
  // The ticket's Total, from lib/pricing (service charge and tax included).
  total: string;
  time: string;
  late: boolean;
};
export type OpenOrders = { count: number; waitingForBill: number; rows: OpenOrderRow[] };

const LIVE_LIST_SIZE = 6;

// Every Open, Sent or Served order, oldest first (the longest waiting at
// the top); the list shows the first few.
export async function getOpenOrders(now: Date = new Date()): Promise<OpenOrders> {
  const where: Prisma.OrderWhereInput = { deletedAt: null, status: { in: [...TABLE_HOLDING_STATUSES] } };
  const [byStatus, orders, settings] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.order.findMany({
      where,
      orderBy: [{ openedAt: "asc" }, { number: "asc" }],
      take: LIVE_LIST_SIZE,
      select: {
        id: true,
        type: true,
        status: true,
        guests: true,
        openedAt: true,
        discountType: true,
        discountValue: true,
        serviceCharge: true,
        table: { select: { name: true } },
        waiter: { select: { firstName: true } },
        items: {
          where: { deletedAt: null, cancelledAt: null },
          select: { quantity: true, unitPrice: true, taxType: true, taxRate: true, cancelledAt: true, deletedAt: true },
        },
      },
    }),
    getBusinessSettings(),
  ]);
  const count = (status: OrderStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0;

  return {
    count: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    waitingForBill: count("SERVED"),
    rows: orders.map((order) => {
      const minutes = Math.max(0, Math.floor((now.getTime() - order.openedAt.getTime()) / 60_000));
      return {
        id: order.id,
        badge: order.table?.name ?? NO_TABLE_BADGE[order.type],
        waiter: order.waiter?.firstName ?? "No waiter",
        guests: order.guests,
        status: OPEN_ORDER_STATUS_LABEL[order.status] ?? order.status,
        total: formatNaira(orderTotals(order.items, settings.restaurantServiceChargePercent, order).total.toFixed(2)),
        time: formatOpenFor(minutes),
        late: minutes > LATE_ORDER_MINUTES,
      };
    }),
  };
}

// ---- Avg prep time ---------------------------------------------------------

export type PrepTime = { current: number | null; previous: number | null };

// Sent → Ready, in seconds, over the dishes that became Ready in the
// range — the prep-time report's own query (getPrepSummary). null with none.
export async function getPrepTime(period: DashboardPeriod): Promise<PrepTime> {
  const [current, previous] = await Promise.all([getPrepSummary(period.range), getPrepSummary(period.previous)]);
  return { current: current.avgTotal, previous: previous.avgTotal };
}

// ---- Cancelled lines -------------------------------------------------------

export type CancelledLines = { current: { count: number; value: string }; previous: { count: number; value: string } };

// Lines cancelled in the range, and what they were worth at their price
// (unit price × quantity; service charge left out).
export async function getCancelledLines(period: DashboardPeriod): Promise<CancelledLines> {
  const [current, previous] = await Promise.all(
    [period.range, period.previous].map(async (range) => {
      const { start, end } = periodBounds(range);
      const [row] = await prisma.$queryRaw<{ count: bigint; value: Prisma.Decimal | null }[]>`
        SELECT COUNT(*) AS count, SUM(i.\`unitPrice\` * i.\`quantity\`) AS value
        FROM \`OrderItem\` i
        JOIN \`Order\` o ON o.\`id\` = i.\`orderId\`
        WHERE i.\`cancelledAt\` >= ${start} AND i.\`cancelledAt\` < ${end}
          AND i.\`deletedAt\` IS NULL AND o.\`deletedAt\` IS NULL`;
      return { count: Number(row?.count ?? 0), value: money(row?.value) };
    }),
  );
  return { current, previous };
}

// ---- Sales by hour ---------------------------------------------------------

// Billed revenue by the hour (app clock) the sale was made; the hours add
// up to the Revenue tile.
export async function getSalesByHour(period: DashboardPeriod, now: Date = new Date()): Promise<{ hour: number; total: string }[]> {
  const offset = appZoneOffsetMinutes(now);
  const rows = await prisma.$queryRaw<{ hour: number | bigint; total: Prisma.Decimal | null }[]>`
    SELECT HOUR(DATE_ADD(s.\`createdAt\`, INTERVAL ${offset} MINUTE)) AS hour, SUM(s.\`grandTotal\`) AS total
    FROM \`Sale\` s
    JOIN \`Order\` o ON o.\`saleId\` = s.\`id\`
    WHERE ${billedSaleSql(period.range)}
    GROUP BY hour
    ORDER BY hour`;
  return rows.map((row) => ({ hour: Number(row.hour), total: money(row.total) }));
}

// ---- Order type mix --------------------------------------------------------

export type TypeMixRow = { type: OrderType; orders: number; amount: string };

// Orders opened in the range by type (the bar), and each type's billed
// revenue (the amounts add up to the Revenue tile).
export async function getOrderTypeMix(period: DashboardPeriod): Promise<TypeMixRow[]> {
  const [counts, amounts] = await Promise.all([
    prisma.order.groupBy({ by: ["type"], where: ordersOpenedIn(period.range), _count: { _all: true } }),
    prisma.$queryRaw<{ type: OrderType; amount: Prisma.Decimal | null }[]>`
      SELECT o.\`type\` AS type, SUM(s.\`grandTotal\`) AS amount
      FROM \`Sale\` s
      JOIN \`Order\` o ON o.\`saleId\` = s.\`id\`
      WHERE ${billedSaleSql(period.range)}
      GROUP BY o.\`type\``,
  ]);
  return ORDER_TYPES.map((type) => ({
    type,
    orders: counts.find((row) => row.type === type)?._count._all ?? 0,
    amount: money(amounts.find((row) => row.type === type)?.amount),
  }));
}

// ---- Top dishes ------------------------------------------------------------

export type TopDish = { productId: string; name: string; quantity: number; revenue: string };

const TOP_DISHES = 5;

// The dishes on billed orders (the revenue rule), most sold first; revenue
// is unit price × quantity (cancelled and removed lines left out).
export async function getTopDishes(period: DashboardPeriod): Promise<TopDish[]> {
  const rows = await prisma.$queryRaw<{ productId: string; name: string; quantity: Prisma.Decimal | bigint | number; revenue: Prisma.Decimal | null }[]>`
    SELECT p.\`id\` AS productId, p.\`name\` AS name, SUM(i.\`quantity\`) AS quantity, SUM(i.\`unitPrice\` * i.\`quantity\`) AS revenue
    FROM \`OrderItem\` i
    JOIN \`Order\` o ON o.\`id\` = i.\`orderId\`
    JOIN \`Sale\` s ON s.\`id\` = o.\`saleId\`
    JOIN \`Product\` p ON p.\`id\` = i.\`productId\`
    WHERE ${billedSaleSql(period.range)} AND i.\`deletedAt\` IS NULL AND i.\`cancelledAt\` IS NULL
    GROUP BY p.\`id\`, p.\`name\`
    ORDER BY quantity DESC, revenue DESC, p.\`name\` ASC
    LIMIT ${TOP_DISHES}`;
  return rows.map((row) => ({ productId: row.productId, name: row.name, quantity: Number(row.quantity), revenue: money(row.revenue) }));
}

// ---- Low-stock ingredients -------------------------------------------------

export type LowStockRow = { productId: string; name: string; warehouseId: string; warehouse: string; quantity: number; unit: string; level: StockLevel };
export type LowStock = { rows: LowStockRow[]; total: number };

const LOW_STOCK_LIST_SIZE = 6;

// INGREDIENT products at or below their alert level in the restaurant's
// warehouse(s) — those its dining areas take stock from. Lowest first,
// relative to the alert level.
export async function getLowStockIngredients(): Promise<LowStock> {
  const restaurantWarehouses = Prisma.sql`
    SELECT DISTINCT a.\`warehouseId\` FROM \`DiningArea\` a WHERE a.\`deletedAt\` IS NULL`;
  const low = Prisma.sql`
    FROM \`ProductStock\` ps
    JOIN \`Product\` p ON p.\`id\` = ps.\`productId\`
    JOIN \`Warehouse\` w ON w.\`id\` = ps.\`warehouseId\`
    JOIN \`Unit\` u ON u.\`id\` = p.\`unitId\`
    WHERE p.\`productType\` = 'INGREDIENT' AND p.\`deletedAt\` IS NULL AND w.\`deletedAt\` IS NULL
      AND p.\`stockAlert\` IS NOT NULL AND ps.\`quantity\` <= p.\`stockAlert\`
      AND ps.\`warehouseId\` IN (${restaurantWarehouses})`;
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<{ productId: string; name: string; warehouseId: string; warehouse: string; quantity: number | bigint; alert: number | bigint; unit: string }[]>`
      SELECT p.\`id\` AS productId, p.\`name\` AS name, w.\`id\` AS warehouseId, w.\`name\` AS warehouse, ps.\`quantity\` AS quantity, p.\`stockAlert\` AS alert, u.\`name\` AS unit
      ${low}
      ORDER BY ps.\`quantity\` / GREATEST(p.\`stockAlert\`, 1) ASC, p.\`name\` ASC, w.\`name\` ASC
      LIMIT ${LOW_STOCK_LIST_SIZE}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total ${low}`,
  ]);
  return {
    rows: rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      warehouseId: row.warehouseId,
      warehouse: row.warehouse,
      quantity: Number(row.quantity),
      unit: row.unit,
      level: stockLevel(Number(row.quantity), Number(row.alert)),
    })),
    total: Number(count[0]?.total ?? 0),
  };
}

// ---- Page subtitle ---------------------------------------------------------

// The restaurant's warehouse(s) — the ones its dining areas take stock from
// ("Main Branch").
export async function getRestaurantWarehouses(): Promise<string[]> {
  const warehouses = await prisma.warehouse.findMany({
    where: { deletedAt: null, diningAreas: { some: { deletedAt: null } } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return warehouses.map((w) => w.name);
}
