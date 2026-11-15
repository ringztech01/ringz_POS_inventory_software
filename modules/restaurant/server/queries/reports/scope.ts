import "server-only";
import { Prisma } from "@prisma/client";
import type { ReportFilters, ReportPeriod } from "./filters";

// What every restaurant report counts: orders settled in the period — Billed
// by settle (Part 6), so closed with their Sale — never a training order
// (Part 6f), nothing deleted; one order even when the bill was split. The
// filters narrow it:
//   area     its table's dining area (takeaways and tabs have none)
//   waiter   its waiter
//   type     Dine-in, Takeaway, Bar tab, Delivery
//   station  at least one line made at that station
//   device   at least one payment taken at that device's till (Part 6f)
// The business is the one BusinessSetting row: every order is its own.

export type ReportResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function settledOrdersWhere(period: Pick<ReportPeriod, "start" | "end">, filters: ReportFilters): Prisma.OrderWhereInput {
  return {
    deletedAt: null,
    training: false,
    status: "BILLED",
    closedAt: { gte: period.start, lt: period.end },
    saleId: { not: null },
    sale: {
      deletedAt: null,
      ...(filters.device ? { payments: { some: { deletedAt: null, till: { deviceId: filters.device } } } } : {}),
    },
    ...(filters.area ? { table: { areaId: filters.area } } : {}),
    ...(filters.waiter ? { waiterId: filters.waiter } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.station ? { items: { some: { stationId: filters.station, deletedAt: null, cancelledAt: null } } } : {}),
  };
}

// The same, as SQL for the reports that add up in the database. Use with
// ORDER_SALE (o: the Order, s: its Sale); closedIn adds the period.
export const ORDER_SALE = Prisma.sql`\`Order\` o JOIN \`Sale\` s ON s.\`id\` = o.\`saleId\` AND s.\`deletedAt\` IS NULL`;

export function orderScopeSql(filters: ReportFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`o.\`deletedAt\` IS NULL AND o.\`training\` = 0 AND o.\`status\` = 'BILLED' AND o.\`closedAt\` IS NOT NULL`];
  if (filters.area) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM \`Table\` t WHERE t.\`id\` = o.\`tableId\` AND t.\`areaId\` = ${filters.area})`);
  if (filters.waiter) parts.push(Prisma.sql`o.\`waiterId\` = ${filters.waiter}`);
  if (filters.type) parts.push(Prisma.sql`o.\`type\` = ${filters.type}`);
  if (filters.station) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM \`OrderItem\` fi WHERE fi.\`orderId\` = o.\`id\` AND fi.\`stationId\` = ${filters.station} AND fi.\`deletedAt\` IS NULL AND fi.\`cancelledAt\` IS NULL)`);
  if (filters.device) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM \`SalePayment\` fp JOIN \`TillSession\` ft ON ft.\`id\` = fp.\`tillSessionId\` WHERE fp.\`saleId\` = s.\`id\` AND fp.\`deletedAt\` IS NULL AND ft.\`deviceId\` = ${filters.device})`,
    );
  }
  return Prisma.join(parts, " AND ");
}

export const closedIn = (period: Pick<ReportPeriod, "start" | "end">) => Prisma.sql`o.\`closedAt\` >= ${period.start} AND o.\`closedAt\` < ${period.end}`;
