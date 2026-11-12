import "server-only";
import type { Prisma } from "@prisma/client";
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
