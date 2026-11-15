import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { deviceLabel } from "@/lib/hardware/deviceLabel";
import type { ShiftRow, TillRow } from "../../../lib/reportShifts";
import type { ReportFilters, ReportPeriod } from "./filters";
import type { ReportResult } from "./scope";

// Restaurant Reports › Shifts & cash-up (Step 9). Read-only, added up in the
// database (one row per shift, one per till session).
//
// Shifts (Part 6f clock in / out) that started in the period: the person,
// their role, in and out (an open one: so far), the settled orders they
// waited while on it and its net sales (bills less refunds made on it), and
// the open tables handed over when it ended (the shift.handover log). The
// waiter filter narrows them to that person.
//
// Cash-ups (Part 6f Step 7b): till sessions opened in the period. A closed
// one keeps the figures as counted; an open one's are worked out now. Drawer
// opens: the till's drawer events while it was open (not printer tests).
// The device filter narrows them to that till.

export type ShiftsData = { shifts: ShiftRow[]; tills: TillRow[]; varianceLimit: Prisma.Decimal };

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? null : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

// Set-based, so each shift and till costs a few index reads, never a pass
// over the waiter's (or the device's) whole history (Step 11: 578 s → under
// a second for 90 days of 50,000 orders). Each join range-reads one index
// for each shift or till ("Range checked for each record"): Order
// (waiterId, closedAt), SaleReturn (createdAt), DrawerEvent (deviceId,
// createdAt) — the indexes of migration 20261113120000_add_report_indexes,
// named in FORCE INDEX because the planner otherwise picks a full scan. The
// "x >= y AND x <= y" is an equality it can't turn into a lookup on the
// first column alone (which would read every order the waiter ever had).
type ShiftBase = { id: string; userId: string; startedAt: Date; endedAt: Date | null; endReason: string | null };
type TillBase = {
  id: string;
  deviceId: string;
  openedById: string;
  openedAt: Date;
  float: unknown;
  closedById: string | null;
  closedAt: Date | null;
  cashSales: unknown;
  cashTips: unknown;
  cashRefunds: unknown;
  counted: unknown;
  expected: unknown;
  variance: unknown;
  zPrintedAt: Date | null;
};
type PerRow = { id: string; amount: unknown };

async function shiftFigures(period: ReportPeriod, filters: ReportFilters, now: Date) {
  const scope = Prisma.sql`sh.startedAt >= ${period.start} AND sh.startedAt < ${period.end}
    ${filters.waiter ? Prisma.sql`AND sh.userId = ${filters.waiter}` : Prisma.empty}`;
  const [shifts, sales, refunds, handovers] = await Promise.all([
    prisma.$queryRaw<ShiftBase[]>`
      SELECT sh.id AS id, sh.userId AS userId, sh.startedAt AS startedAt, sh.endedAt AS endedAt, sh.endReason AS endReason
      FROM StaffShift sh
      WHERE ${scope}
      ORDER BY sh.startedAt DESC
      LIMIT 1000`,
    // The settled orders they waited while on it, and their bills.
    prisma.$queryRaw<{ id: string; orders: unknown; amount: unknown }[]>`
      SELECT sh.id AS id, COUNT(*) AS orders, COALESCE(SUM(s.grandTotal), 0) AS amount
      FROM StaffShift sh
      STRAIGHT_JOIN \`Order\` o FORCE INDEX (Order_waiterId_closedAt_idx) ON o.waiterId >= sh.userId AND o.waiterId <= sh.userId AND o.closedAt >= sh.startedAt AND o.closedAt < COALESCE(sh.endedAt, ${now})
      STRAIGHT_JOIN Sale s ON s.id = o.saleId AND s.deletedAt IS NULL
      WHERE ${scope} AND o.status = 'BILLED' AND o.training = 0 AND o.deletedAt IS NULL
      GROUP BY sh.id`,
    // Refunds made while on it, of their orders.
    prisma.$queryRaw<PerRow[]>`
      SELECT sh.id AS id, COALESCE(SUM(r.grandTotal), 0) AS amount
      FROM StaffShift sh
      STRAIGHT_JOIN SaleReturn r FORCE INDEX (SaleReturn_createdAt_idx) ON r.createdAt >= sh.startedAt AND r.createdAt < COALESCE(sh.endedAt, ${now}) AND r.deletedAt IS NULL
      STRAIGHT_JOIN \`Order\` o ON o.saleId = r.saleId AND o.waiterId = sh.userId AND o.training = 0 AND o.deletedAt IS NULL
      WHERE ${scope}
      GROUP BY sh.id`,
    // Handovers logged from the period's start on, newest first (each
    // shift takes its own below).
    prisma.$queryRaw<{ userId: string | null; createdAt: Date; count: unknown; handedTo: string | null }[]>`
      SELECT a.userId AS userId, a.createdAt AS createdAt, JSON_EXTRACT(a.meta, '$.count') AS count, JSON_UNQUOTE(JSON_EXTRACT(a.meta, '$.to')) AS handedTo
      FROM AuditLog a
      WHERE a.businessId = ${BUSINESS_SETTINGS_ID} AND a.createdAt >= ${period.start} AND a.action = 'shift.handover'
        ${filters.waiter ? Prisma.sql`AND a.userId = ${filters.waiter}` : Prisma.empty}
      ORDER BY a.createdAt DESC`,
  ]);
  const salesOf = new Map(sales.map((r) => [r.id, r]));
  const refundsOf = new Map(refunds.map((r) => [r.id, r.amount]));
  return shifts.map((sh) => {
    // Its last handover: logged while on it, or within a minute of its end.
    const until = (sh.endedAt ?? now).getTime() + 60_000;
    const handover = handovers.find((a) => a.userId === sh.userId && a.createdAt >= sh.startedAt && a.createdAt.getTime() <= until);
    return {
      ...sh,
      orders: salesOf.get(sh.id)?.orders ?? 0,
      sales: salesOf.get(sh.id)?.amount ?? 0,
      refunds: refundsOf.get(sh.id) ?? 0,
      handedOver: handover?.count ?? null,
      handedTo: handover?.handedTo ?? null,
    };
  });
}

async function tillFigures(period: ReportPeriod, filters: ReportFilters, now: Date) {
  const tills = await prisma.$queryRaw<TillBase[]>`
    SELECT ts.id AS id, ts.deviceId AS deviceId, ts.openedById AS openedById, ts.openedAt AS openedAt, ts.\`float\` AS \`float\`,
           ts.closedById AS closedById, ts.closedAt AS closedAt, ts.cashSales AS cashSales, ts.cashTips AS cashTips, ts.cashRefunds AS cashRefunds,
           ts.counted AS counted, ts.expected AS expected, ts.variance AS variance, ts.zPrintedAt AS zPrintedAt
    FROM TillSession ts
    WHERE ts.openedAt >= ${period.start} AND ts.openedAt < ${period.end}
      ${filters.device ? Prisma.sql`AND ts.deviceId = ${filters.device}` : Prisma.empty}
    ORDER BY ts.openedAt DESC
    LIMIT 1000`;
  if (!tills.length) return [];
  // Worked out now only where the till didn't keep its figures (an open one).
  const live = tills.filter((t) => !t.closedAt || t.cashSales === null || t.cashTips === null || t.cashRefunds === null).map((t) => t.id);
  const liveIds = live.length ? Prisma.join(live) : null;
  const none = Promise.resolve<PerRow[]>([]);
  const [liveSales, liveTips, liveRefunds, drawer] = await Promise.all([
    liveIds
      ? prisma.$queryRaw<PerRow[]>`SELECT p.tillSessionId AS id, COALESCE(SUM(p.amount), 0) AS amount FROM SalePayment p WHERE p.tillSessionId IN (${liveIds}) AND p.deletedAt IS NULL AND p.paymentType = 'CASH' GROUP BY p.tillSessionId`
      : none,
    liveIds
      ? prisma.$queryRaw<PerRow[]>`SELECT t.tillSessionId AS id, COALESCE(SUM(t.amount), 0) AS amount FROM OrderTip t WHERE t.tillSessionId IN (${liveIds}) AND t.deletedAt IS NULL AND t.paymentType = 'CASH' GROUP BY t.tillSessionId`
      : none,
    liveIds
      ? prisma.$queryRaw<PerRow[]>`SELECT rp.tillSessionId AS id, COALESCE(SUM(rp.amount), 0) AS amount FROM SaleReturnPayment rp WHERE rp.tillSessionId IN (${liveIds}) AND rp.deletedAt IS NULL AND rp.paymentType = 'CASH' GROUP BY rp.tillSessionId`
      : none,
    // Its drawer events while it was open (not printer tests).
    prisma.$queryRaw<{ id: string; opens: unknown; byHand: unknown }[]>`
      SELECT ts.id AS id, COUNT(*) AS opens, COALESCE(SUM(de.reason = 'MANUAL'), 0) AS byHand
      FROM TillSession ts
      STRAIGHT_JOIN DrawerEvent de FORCE INDEX (DrawerEvent_deviceId_createdAt_idx) ON de.deviceId >= ts.deviceId AND de.deviceId <= ts.deviceId AND de.createdAt >= ts.openedAt AND de.createdAt <= COALESCE(ts.closedAt, ${now}) AND de.reason <> 'TEST'
      WHERE ts.id IN (${Prisma.join(tills.map((t) => t.id))})
      GROUP BY ts.id`,
  ]);
  const byId = (rows: PerRow[]) => new Map(rows.map((r) => [r.id, r.amount]));
  const [sales, tips, refunds] = [byId(liveSales), byId(liveTips), byId(liveRefunds)];
  const drawerOf = new Map(drawer.map((d) => [d.id, d]));
  return tills.map((t) => ({
    ...t,
    liveSales: sales.get(t.id) ?? 0,
    liveTips: tips.get(t.id) ?? 0,
    liveRefunds: refunds.get(t.id) ?? 0,
    drawerOpens: drawerOf.get(t.id)?.opens ?? 0,
    drawerByHand: drawerOf.get(t.id)?.byHand ?? 0,
  }));
}

export async function getShiftsReport(period: ReportPeriod, filters: ReportFilters): Promise<ReportResult<ShiftsData>> {
  try {
    const now = new Date();
    const [shifts, tills, setting] = await Promise.all([
      shiftFigures(period, filters, now),
      tillFigures(period, filters, now),
      prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantCashVarianceLimit: true } }),
    ]);

    const userIds = [...new Set([...shifts.map((s) => s.userId), ...tills.flatMap((t) => [t.openedById, t.closedById])].filter((x): x is string => !!x))];
    const deviceIds = [...new Set(tills.map((t) => t.deviceId))];
    const [users, devices] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, firstName: true, lastName: true, userRole: { select: { name: true } } } }) : Promise.resolve([]),
      deviceIds.length ? prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, userAgent: true } }) : Promise.resolve([]),
    ]);
    const user = new Map(users.map((u) => [u.id, { name: u.displayName || `${u.firstName} ${u.lastName}`.trim(), role: u.userRole?.name ?? null }]));
    const device = new Map(devices.map((d) => [d.id, deviceLabel(d) ?? "Device"]));

    return {
      ok: true,
      data: {
        shifts: shifts.map((s) => ({
          id: s.id,
          userId: s.userId,
          name: user.get(s.userId)?.name ?? "Deleted user",
          role: user.get(s.userId)?.role ?? null,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          autoEnded: s.endReason === "AUTO",
          orders: int(s.orders),
          sales: dec(s.sales) ?? ZERO,
          refunds: dec(s.refunds) ?? ZERO,
          handedOver: s.handedOver === null ? 0 : int(s.handedOver),
          handedTo: s.handedTo,
        })),
        tills: tills.map((t) => ({
          id: t.id,
          deviceId: t.deviceId,
          device: device.get(t.deviceId) ?? "Removed device",
          openedBy: user.get(t.openedById)?.name ?? "Deleted user",
          closedBy: t.closedById ? (user.get(t.closedById)?.name ?? "Deleted user") : null,
          openedAt: t.openedAt,
          closedAt: t.closedAt,
          float: dec(t.float) ?? ZERO,
          // Closed: as counted; open: so far.
          cashSales: (t.closedAt ? dec(t.cashSales) : null) ?? dec(t.liveSales) ?? ZERO,
          cashTips: (t.closedAt ? dec(t.cashTips) : null) ?? dec(t.liveTips) ?? ZERO,
          cashRefunds: (t.closedAt ? dec(t.cashRefunds) : null) ?? dec(t.liveRefunds) ?? ZERO,
          drawerOpens: int(t.drawerOpens),
          drawerByHand: int(t.drawerByHand),
          counted: dec(t.counted),
          storedExpected: dec(t.expected),
          storedVariance: dec(t.variance),
          zPrinted: t.zPrintedAt !== null,
        })),
        varianceLimit: setting?.restaurantCashVarianceLimit ?? new Prisma.Decimal(500),
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: shifts & cash-up failed:", error);
    return { ok: false, error: "The shifts & cash-up report couldn't be loaded. Please try again." };
  }
}
