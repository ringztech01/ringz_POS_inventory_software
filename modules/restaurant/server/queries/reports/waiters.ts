import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WaiterAmountRow, WaiterCountRow, WaiterOrderRow, WaiterShiftRow } from "../../../lib/reportWaiters";
import type { ReportFilters, ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › By waiter (Step 4): per person, added up in the
// database, put together by lib/reportWaiters.ts. Read-only.
//
// The order figures, tips and discounts follow the report's filters (the
// waiter filter: orders they waited). Voids are the period's voids — the
// order's area and type, the line's station, and the person who voided for
// the waiter filter. Overrides and shifts are the person's own (the waiter
// filter only). Neither depends on a payment, so the device filter doesn't
// narrow them.

export type WaiterData = {
  orders: WaiterOrderRow[];
  refunds: WaiterAmountRow[];
  tips: WaiterAmountRow[];
  discounts: WaiterCountRow[];
  voids: WaiterCountRow[];
  overrides: { userId: string; count: number }[];
  shifts: WaiterShiftRow[];
  names: Map<string, string>;
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

async function orders(period: ReportPeriod, filters: ReportFilters): Promise<WaiterOrderRow[]> {
  const rows = await prisma.$queryRaw<{ userId: string | null; orders: unknown; covers: unknown; sales: unknown; seconds: unknown }[]>`
    SELECT o.waiterId AS userId, COUNT(*) AS orders, COALESCE(SUM(o.guests), 0) AS covers, COALESCE(SUM(s.grandTotal), 0) AS sales,
           COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, o.openedAt, o.closedAt))), 0) AS seconds
    FROM ${ORDER_SALE}
    WHERE ${orderScopeSql(filters)} AND ${closedIn(period)}
    GROUP BY o.waiterId`;
  return rows.map((r) => ({ userId: r.userId, orders: int(r.orders), covers: int(r.covers), sales: dec(r.sales), tableSeconds: int(r.seconds) }));
}

async function refunds(period: ReportPeriod, filters: ReportFilters): Promise<WaiterAmountRow[]> {
  const rows = await prisma.$queryRaw<{ userId: string | null; amount: unknown }[]>`
    SELECT o.waiterId AS userId, COALESCE(SUM(r.grandTotal), 0) AS amount
    FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId
    WHERE r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}
    GROUP BY o.waiterId`;
  return rows.map((r) => ({ userId: r.userId, amount: dec(r.amount) }));
}

async function tips(period: ReportPeriod, filters: ReportFilters): Promise<WaiterAmountRow[]> {
  const rows = await prisma.$queryRaw<{ userId: string; amount: unknown }[]>`
    SELECT t.waiterId AS userId, COALESCE(SUM(t.amount), 0) AS amount
    FROM OrderTip t JOIN ${ORDER_SALE} ON o.id = t.orderId
    WHERE t.deletedAt IS NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
    GROUP BY t.waiterId`;
  return rows.map((r) => ({ userId: r.userId, amount: dec(r.amount) }));
}

// The bill's discount as the Sale has it, credited to whoever put it on.
async function discounts(period: ReportPeriod, filters: ReportFilters): Promise<WaiterCountRow[]> {
  const rows = await prisma.$queryRaw<{ userId: string | null; count: unknown; amount: unknown }[]>`
    SELECT o.discountById AS userId, COUNT(*) AS count, COALESCE(SUM(s.discount), 0) AS amount
    FROM ${ORDER_SALE}
    WHERE o.discountType IS NOT NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
    GROUP BY o.discountById`;
  return rows.map((r) => ({ userId: r.userId, count: int(r.count), amount: dec(r.amount) }));
}

// Sent lines voided in the period (any order but a training or deleted one).
async function voids(period: ReportPeriod, filters: ReportFilters): Promise<WaiterCountRow[]> {
  const rows = await prisma.$queryRaw<{ userId: string | null; count: unknown; amount: unknown }[]>`
    SELECT i.cancelledById AS userId, COUNT(*) AS count, COALESCE(SUM(i.quantity * i.unitPrice), 0) AS amount
    FROM OrderItem i JOIN \`Order\` o ON o.id = i.orderId
    WHERE i.cancelledAt >= ${period.start} AND i.cancelledAt < ${period.end} AND i.deletedAt IS NULL
      AND o.deletedAt IS NULL AND o.training = 0
      ${filters.area ? Prisma.sql`AND EXISTS (SELECT 1 FROM \`Table\` t WHERE t.id = o.tableId AND t.areaId = ${filters.area})` : Prisma.empty}
      ${filters.type ? Prisma.sql`AND o.type = ${filters.type}` : Prisma.empty}
      ${filters.station ? Prisma.sql`AND i.stationId = ${filters.station}` : Prisma.empty}
      ${filters.waiter ? Prisma.sql`AND i.cancelledById = ${filters.waiter}` : Prisma.empty}
    GROUP BY i.cancelledById`;
  return rows.map((r) => ({ userId: r.userId, count: int(r.count), amount: dec(r.amount) }));
}

// Each override is logged against both people (Part 6f): this counts the
// ones made for someone (override.<kind>), not the approvals.
async function overrides(period: ReportPeriod, filters: ReportFilters): Promise<{ userId: string; count: number }[]> {
  const rows = await prisma.$queryRaw<{ userId: string; count: unknown }[]>`
    SELECT a.userId AS userId, COUNT(*) AS count
    FROM AuditLog a
    WHERE a.action LIKE 'override.%' AND a.action NOT LIKE '%.approve' AND a.userId IS NOT NULL
      AND a.createdAt >= ${period.start} AND a.createdAt < ${period.end}
      ${filters.waiter ? Prisma.sql`AND a.userId = ${filters.waiter}` : Prisma.empty}
    GROUP BY a.userId`;
  return rows.map((r) => ({ userId: r.userId, count: int(r.count) }));
}

// Time on shift inside the period (an open shift: up to now).
async function shifts(period: ReportPeriod, filters: ReportFilters): Promise<WaiterShiftRow[]> {
  const now = new Date();
  const end = period.end < now ? period.end : now;
  if (end <= period.start) return [];
  const rows = await prisma.$queryRaw<{ userId: string; seconds: unknown }[]>`
    SELECT sh.userId AS userId,
           COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(sh.startedAt, ${period.start}), LEAST(COALESCE(sh.endedAt, ${end}), ${end})))), 0) AS seconds
    FROM StaffShift sh
    WHERE sh.startedAt < ${end} AND (sh.endedAt IS NULL OR sh.endedAt > ${period.start})
      ${filters.waiter ? Prisma.sql`AND sh.userId = ${filters.waiter}` : Prisma.empty}
    GROUP BY sh.userId`;
  return rows.map((r) => ({ userId: r.userId, seconds: int(r.seconds) })).filter((r) => r.seconds > 0);
}

export async function getWaiterReport(period: ReportPeriod, filters: ReportFilters): Promise<ReportResult<WaiterData>> {
  try {
    const [o, r, t, d, v, ov, sh] = await Promise.all([orders(period, filters), refunds(period, filters), tips(period, filters), discounts(period, filters), voids(period, filters), overrides(period, filters), shifts(period, filters)]);
    // Shifts only count for people with something else to show.
    const people = new Set([...o, ...r, ...t, ...d, ...v, ...ov].map((x) => x.userId).filter((x): x is string => !!x));
    const users = people.size ? await prisma.user.findMany({ where: { id: { in: [...people] } }, select: { id: true, displayName: true, firstName: true, lastName: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.displayName || `${u.firstName} ${u.lastName}`.trim()]));
    return { ok: true, data: { orders: o, refunds: r, tips: t, discounts: d, voids: v, overrides: ov, shifts: sh.filter((x) => people.has(x.userId)), names } };
  } catch (error) {
    console.error("[restaurant] reports: by waiter failed:", error);
    return { ok: false, error: "The waiter report couldn't be loaded. Please try again." };
  }
}
