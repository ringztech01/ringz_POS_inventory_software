import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DepartmentKey } from "../../../lib/reportOverview";
import type { DishCostRow, DishInfo, DishRefundRow, DishSalesRow, ModifierRow } from "../../../lib/reportDishes";
import type { ReportFilters, ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › By dish (Step 3): per product, added up in the
// database, then put together by lib/reportDishes.ts. Read-only.
//
// A bill's items total is its Sale's grandTotal + discount − shipping (the
// restaurant puts tax on the lines and the service charge on shipping), so
// each line's share of the discount needs no second pass. The station filter
// narrows the dishes too: only those made at that station.

export type DishData = {
  sales: DishSalesRow[];
  refunds: DishRefundRow[];
  costs: DishCostRow[] | null;
  info: DishInfo[];
  modifiers: ModifierRow[];
  minutes86: Map<string, number> | null;
  // When the 86 log began (null: nothing logged yet).
  logSince: Date | null;
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

// Billed lines: sent, not cancelled or removed, not remakes.
const BILLED = Prisma.sql`i.deletedAt IS NULL AND i.cancelledAt IS NULL AND i.kitchenStatus <> 'NEW' AND i.remakeOfId IS NULL`;

// The station filter on a Sale/return line: that product was made there in this order.
const atStation = (filters: ReportFilters, productColumn: Prisma.Sql) =>
  filters.station
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM OrderItem fs WHERE fs.orderId = o.id AND fs.productId = ${productColumn} AND fs.stationId = ${filters.station} AND fs.deletedAt IS NULL AND fs.cancelledAt IS NULL)`
    : Prisma.empty;
const lineAtStation = (filters: ReportFilters) => (filters.station ? Prisma.sql`AND i.stationId = ${filters.station}` : Prisma.empty);

// Up to 20 options a line: positions 0–19 in its modifiers array.
const POSITIONS = Prisma.raw(Array.from({ length: 20 }, (_, n) => `SELECT ${n} AS n`).join(" UNION ALL "));

async function sales(period: ReportPeriod, filters: ReportFilters): Promise<DishSalesRow[]> {
  const rows = await prisma.$queryRaw<{ productId: string; quantity: unknown; gross: unknown; discount: unknown }[]>`
    SELECT si.productId AS productId,
           COALESCE(SUM(si.quantity), 0) AS quantity,
           COALESCE(SUM(si.subtotal), 0) AS gross,
           COALESCE(SUM(CASE WHEN s.grandTotal + s.discount - s.shipping > 0 THEN si.subtotal * s.discount / (s.grandTotal + s.discount - s.shipping) ELSE 0 END), 0) AS discount
    FROM SaleItem si JOIN ${ORDER_SALE} ON o.saleId = si.saleId
    WHERE ${orderScopeSql(filters)} AND ${closedIn(period)} ${atStation(filters, Prisma.sql`si.productId`)}
    GROUP BY si.productId`;
  return rows.map((r) => ({ productId: r.productId, quantity: int(r.quantity), gross: dec(r.gross), discount: dec(r.discount) }));
}

async function refunds(period: ReportPeriod, filters: ReportFilters): Promise<DishRefundRow[]> {
  const rows = await prisma.$queryRaw<{ productId: string; quantity: unknown; amount: unknown }[]>`
    SELECT ri.productId AS productId,
           COALESCE(SUM(ri.quantity), 0) AS quantity,
           COALESCE(SUM(ri.subtotal - CASE WHEN r.grandTotal + r.discount - r.shipping > 0 THEN ri.subtotal * r.discount / (r.grandTotal + r.discount - r.shipping) ELSE 0 END), 0) AS amount
    FROM SaleReturnItem ri JOIN SaleReturn r ON r.id = ri.returnId JOIN ${ORDER_SALE} ON o.saleId = r.saleId
    WHERE r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end}
      AND ${orderScopeSql(filters)} ${atStation(filters, Prisma.sql`ri.productId`)}
    GROUP BY ri.productId`;
  return rows.map((r) => ({ productId: r.productId, quantity: int(r.quantity), amount: dec(r.amount) }));
}

async function costs(period: ReportPeriod, filters: ReportFilters): Promise<DishCostRow[]> {
  const rows = await prisma.$queryRaw<{ productId: string; cost: unknown; quantity: unknown; missing: unknown }[]>`
    SELECT i.productId AS productId,
           COALESCE(SUM(i.quantity * i.unitCost), 0) AS cost,
           COALESCE(SUM(i.quantity), 0) AS quantity,
           COALESCE(SUM(CASE WHEN i.unitCost IS NULL THEN i.quantity ELSE 0 END), 0) AS missing
    FROM OrderItem i JOIN ${ORDER_SALE} ON o.id = i.orderId
    WHERE ${BILLED} AND ${orderScopeSql(filters)} AND ${closedIn(period)} ${lineAtStation(filters)}
    GROUP BY i.productId`;
  return rows.map((r) => ({ productId: r.productId, cost: dec(r.cost), quantity: int(r.quantity), missingQuantity: int(r.missing) }));
}

// Each option chosen (OrderItem.modifiers: [{ group, name, price }]): how
// many plates had it, and what its price change brought in.
async function modifiers(period: ReportPeriod, filters: ReportFilters): Promise<ModifierRow[]> {
  const rows = await prisma.$queryRaw<{ productId: string; grp: string | null; name: string | null; times: unknown; revenue: unknown }[]>`
    SELECT i.productId AS productId,
           JSON_UNQUOTE(JSON_EXTRACT(i.modifiers, CONCAT('$[', p.n, '].group'))) AS grp,
           JSON_UNQUOTE(JSON_EXTRACT(i.modifiers, CONCAT('$[', p.n, '].name'))) AS name,
           COALESCE(SUM(i.quantity), 0) AS times,
           COALESCE(SUM(i.quantity * COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(i.modifiers, CONCAT('$[', p.n, '].price'))) AS DECIMAL(12, 2)), 0)), 0) AS revenue
    FROM OrderItem i JOIN ${ORDER_SALE} ON o.id = i.orderId
      JOIN (${POSITIONS}) p ON p.n < JSON_LENGTH(i.modifiers)
    WHERE ${BILLED} AND i.modifiers IS NOT NULL AND JSON_TYPE(i.modifiers) = 'ARRAY'
      AND ${orderScopeSql(filters)} AND ${closedIn(period)} ${lineAtStation(filters)}
    GROUP BY i.productId, grp, name`;
  return rows
    .filter((r) => r.name !== null && r.name !== "null")
    .map((r) => ({ productId: r.productId, group: r.grp && r.grp !== "null" ? r.grp : null, name: r.name!, times: int(r.times), revenue: dec(r.revenue) }));
}

// Minutes each dish was 86'd in the period (up to now): each "off" until the
// next change (or now), cut to the period.
async function minutes86(period: ReportPeriod): Promise<{ minutes: Map<string, number> | null; since: Date | null }> {
  const [first] = await prisma.$queryRaw<{ since: Date | null }[]>`SELECT MIN(createdAt) AS since FROM MenuAvailabilityLog`;
  const since = first?.since ?? null;
  if (!since || period.end <= since) return { minutes: null, since };
  const now = new Date();
  const end = period.end < now ? period.end : now;
  const rows = await prisma.$queryRaw<{ productId: string; seconds: unknown }[]>`
    SELECT l.productId AS productId,
           SUM(GREATEST(0, TIMESTAMPDIFF(SECOND,
             GREATEST(l.createdAt, ${period.start}),
             LEAST(COALESCE((SELECT MIN(x.createdAt) FROM MenuAvailabilityLog x WHERE x.productId = l.productId AND (x.createdAt > l.createdAt OR (x.createdAt = l.createdAt AND x.id > l.id))), ${end}), ${end})
           ))) AS seconds
    FROM MenuAvailabilityLog l
    WHERE l.available = 0 AND l.createdAt < ${end}
    GROUP BY l.productId`;
  return { minutes: new Map(rows.map((r) => [r.productId, Math.floor(int(r.seconds) / 60)])), since };
}

async function infoFor(ids: string[]): Promise<DishInfo[]> {
  if (ids.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, menuGroup: { select: { name: true, department: true, parent: { select: { name: true } } } } },
  });
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    department: (p.menuGroup?.department ?? "NONE") as DepartmentKey,
    group: p.menuGroup ? (p.menuGroup.parent ? `${p.menuGroup.parent.name} › ${p.menuGroup.name}` : p.menuGroup.name) : null,
  }));
}

export async function getDishReport(period: ReportPeriod, filters: ReportFilters, options: { withCost: boolean }): Promise<ReportResult<DishData>> {
  try {
    const [s, r, c, m, log] = await Promise.all([sales(period, filters), refunds(period, filters), options.withCost ? costs(period, filters) : Promise.resolve(null), modifiers(period, filters), minutes86(period)]);
    const info = await infoFor([...new Set([...s.map((x) => x.productId), ...r.map((x) => x.productId)])]);
    return { ok: true, data: { sales: s, refunds: r, costs: c, info, modifiers: m, minutes86: log.minutes, logSince: log.since } };
  } catch (error) {
    console.error("[restaurant] reports: by dish failed:", error);
    return { ok: false, error: "The dish report couldn't be loaded. Please try again." };
  }
}
