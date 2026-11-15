import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { deviceLabel } from "@/lib/hardware/deviceLabel";
import type { ReportFilters, ReportPeriod } from "./filters";
import { settledOrdersWhere, type ReportResult } from "./scope";

// The Reports shell (Step 1): the business day's start, what the filter bar
// offers, and how many settled orders match. Read-only; never throws — a
// failure is logged and becomes { ok: false, error }.

export type ReportOption = { id: string; name: string };

export type ReportSetup = {
  dayStartMinutes: number;
  areas: ReportOption[];
  // Everyone who has waited an order, even if they've since left.
  waiters: ReportOption[];
  stations: ReportOption[];
  // Devices that have had a till open (the device filter: the till that
  // took payment).
  devices: ReportOption[];
};

const FAILED = "The report couldn't be loaded. Please try again.";

const personName = (u: { displayName: string | null; firstName: string; lastName: string }) => u.displayName || `${u.firstName} ${u.lastName}`.trim();

export async function getReportSetup(): Promise<ReportResult<ReportSetup>> {
  try {
    const [setting, areas, waiterIds, stations, deviceIds] = await Promise.all([
      prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantDayStartMinutes: true } }),
      prisma.diningArea.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      // Everyone who has waited an order (not a training one): one index
      // lookup a person, stopping at their first — never a pass over the orders.
      prisma.$queryRaw<{ waiterId: string }[]>`SELECT u.id AS waiterId FROM \`User\` u WHERE EXISTS (SELECT 1 FROM \`Order\` o WHERE o.waiterId = u.id AND o.training = 0 AND o.deletedAt IS NULL)`,
      prisma.kitchenStation.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      prisma.tillSession.groupBy({ by: ["deviceId"] }),
    ]);
    const [waiters, devices] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: waiterIds.map((w) => w.waiterId) } },
        select: { id: true, displayName: true, firstName: true, lastName: true },
      }),
      prisma.device.findMany({ where: { id: { in: deviceIds.map((d) => d.deviceId) } }, select: { id: true, name: true, userAgent: true } }),
    ]);
    const byName = (a: ReportOption, b: ReportOption) => a.name.localeCompare(b.name);
    return {
      ok: true,
      data: {
        dayStartMinutes: setting?.restaurantDayStartMinutes ?? 0,
        areas,
        waiters: waiters.map((u) => ({ id: u.id, name: personName(u) })).sort(byName),
        stations,
        devices: devices.map((d) => ({ id: d.id, name: deviceLabel(d) ?? "Device" })).sort(byName),
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: setup failed:", error);
    return { ok: false, error: FAILED };
  }
}

export async function countSettledOrders(period: Pick<ReportPeriod, "start" | "end">, filters: ReportFilters): Promise<ReportResult<number>> {
  try {
    return { ok: true, data: await prisma.order.count({ where: settledOrdersWhere(period, filters) }) };
  } catch (error) {
    console.error("[restaurant] reports: order count failed:", error);
    return { ok: false, error: FAILED };
  }
}
