import "server-only";
import { Prisma, type OrderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FixtureType, TableShape } from "../../../lib/floorGeometry";
import type { TableInfo, TableOrderRow } from "../../../lib/reportTables";
import type { FloorFixtureView, FloorPlace } from "../floor";
import type { ReportFilters, ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › By table and By order type (Step 5), added up in the
// database and put together by lib/reportTables.ts. Read-only. Orders with
// no table (takeaways, bar tabs, deliveries) aren't in By table.
//
// The heat map draws each dining area as the tablet's floor does (Part 7's
// floor plan: the room's size, its tables where they stand, its fixtures).

export type HeatArea = {
  id: string;
  name: string;
  room: { widthM: number; heightM: number };
  fixtures: FloorFixtureView[];
  tables: { id: string; name: string; place: FloorPlace & { shape: TableShape } }[];
};

export type TableData = {
  orders: TableOrderRow[];
  refunds: { tableId: string; amount: Prisma.Decimal }[];
  info: TableInfo[];
  heat: HeatArea[];
};

export type OrderTypeData = {
  orders: { type: OrderType; orders: number; sales: Prisma.Decimal }[];
  refunds: { type: OrderType; amount: Prisma.Decimal }[];
  prep: { type: OrderType; seconds: number; lines: number }[];
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const metres = (row: { x: unknown; y: unknown; w: unknown; h: unknown; rotation: number }): FloorPlace => ({ x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h), rotation: row.rotation });

async function heatAreas(): Promise<HeatArea[]> {
  const [areas, tables, fixtures] = await Promise.all([
    prisma.diningArea.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, roomWidthM: true, roomHeightM: true } }),
    prisma.table.findMany({ where: { deletedAt: null, area: { deletedAt: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, areaId: true, x: true, y: true, w: true, h: true, rotation: true, shape: true } }),
    prisma.floorFixture.findMany({ where: { deletedAt: null, area: { deletedAt: null } }, orderBy: { createdAt: "asc" }, select: { id: true, areaId: true, type: true, label: true, x: true, y: true, w: true, h: true, rotation: true } }),
  ]);
  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    room: { widthM: Number(a.roomWidthM), heightM: Number(a.roomHeightM) },
    fixtures: fixtures.filter((f) => f.areaId === a.id).map((f) => ({ id: f.id, type: f.type as FixtureType, label: f.label, ...metres(f) })),
    tables: tables.filter((t) => t.areaId === a.id).map((t) => ({ id: t.id, name: t.name, place: { ...metres(t), shape: t.shape } })),
  }));
}

export async function getTableReport(period: ReportPeriod, filters: ReportFilters): Promise<ReportResult<TableData>> {
  try {
    const [orders, refunds, heat] = await Promise.all([
      prisma.$queryRaw<{ tableId: string; orders: unknown; covers: unknown; sales: unknown; seconds: unknown }[]>`
        SELECT o.tableId AS tableId, COUNT(*) AS orders, COALESCE(SUM(o.guests), 0) AS covers, COALESCE(SUM(s.grandTotal), 0) AS sales,
               COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, o.openedAt, o.closedAt))), 0) AS seconds
        FROM ${ORDER_SALE}
        WHERE o.tableId IS NOT NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY o.tableId`,
      prisma.$queryRaw<{ tableId: string; amount: unknown }[]>`
        SELECT o.tableId AS tableId, COALESCE(SUM(r.grandTotal), 0) AS amount
        FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId
        WHERE o.tableId IS NOT NULL AND r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}
        GROUP BY o.tableId`,
      heatAreas(),
    ]);
    const ids = [...new Set([...orders, ...refunds].map((r) => r.tableId))];
    const tables = ids.length ? await prisma.table.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true, area: { select: { id: true, name: true } } } }) : [];
    return {
      ok: true,
      data: {
        orders: orders.map((r) => ({ tableId: r.tableId, orders: int(r.orders), covers: int(r.covers), sales: dec(r.sales), seconds: int(r.seconds) })),
        refunds: refunds.map((r) => ({ tableId: r.tableId, amount: dec(r.amount) })),
        info: tables.map((t) => ({ tableId: t.id, name: t.name, areaId: t.area.id, area: t.area.name, deleted: t.deletedAt !== null })),
        heat,
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: by table failed:", error);
    return { ok: false, error: "The table report couldn't be loaded. Please try again." };
  }
}

export async function getOrderTypeReport(period: ReportPeriod, filters: ReportFilters): Promise<ReportResult<OrderTypeData>> {
  try {
    const [orders, refunds, prep] = await Promise.all([
      prisma.$queryRaw<{ type: OrderType; orders: unknown; sales: unknown }[]>`
        SELECT o.type AS type, COUNT(*) AS orders, COALESCE(SUM(s.grandTotal), 0) AS sales
        FROM ${ORDER_SALE}
        WHERE ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY o.type`,
      prisma.$queryRaw<{ type: OrderType; amount: unknown }[]>`
        SELECT o.type AS type, COALESCE(SUM(r.grandTotal), 0) AS amount
        FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId
        WHERE r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}
        GROUP BY o.type`,
      // As Prep times (Part 4): lines sent and made Ready, not cancelled or removed.
      prisma.$queryRaw<{ type: OrderType; seconds: unknown; lineCount: unknown }[]>`
        SELECT o.type AS type, AVG(TIMESTAMPDIFF(SECOND, i.sentAt, i.readyAt)) AS seconds, COUNT(*) AS lineCount
        FROM OrderItem i JOIN ${ORDER_SALE} ON o.id = i.orderId
        WHERE i.sentAt IS NOT NULL AND i.readyAt IS NOT NULL AND i.deletedAt IS NULL AND i.cancelledAt IS NULL
          ${filters.station ? Prisma.sql`AND i.stationId = ${filters.station}` : Prisma.empty}
          AND ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY o.type`,
    ]);
    return {
      ok: true,
      data: {
        orders: orders.map((r) => ({ type: r.type, orders: int(r.orders), sales: dec(r.sales) })),
        refunds: refunds.map((r) => ({ type: r.type, amount: dec(r.amount) })),
        prep: prep.map((r) => ({ type: r.type, seconds: Math.round(Number(r.seconds ?? 0)), lines: int(r.lineCount) })),
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: by order type failed:", error);
    return { ok: false, error: "The order type report couldn't be loaded. Please try again." };
  }
}
