import "server-only";
import { Prisma, type OrderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { appZoneOffsetMinutes } from "../../../lib/time";
import { totalsOf, type CostSum, type DepartmentKey, type OverviewTotals, type RefundRow, type SalesRow } from "../../../lib/reportOverview";
import type { ReportFilters, ReportPeriod, ReportWindow } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › Overview (Step 2). Everything is added up in the
// database — grouped rows (by day, hour and order type), never one per
// order — then put together by lib/reportOverview.ts. Read-only.
//
//   bills     the settled orders' Sale totals, by when the order closed
//   refunds   Sale Returns against those orders' Sales (the restaurant's
//             refunds and the retail Sales Return page alike), by when they
//             were made — so a refund lowers the period it happened in
//   tips      OrderTip on the period's orders; never in net sales
//   cost      the sold lines' OrderItem.unitCost (cost at settle); only for
//             someone with View Cost
//   waste     ACTIVE waste entries made in the period (not tied to an
//             order, so the order filters don't narrow it)
//   items     Sale lines by department (Food / Bar), less returned lines

export type OverviewData = {
  current: OverviewTotals;
  previous: OverviewTotals;
  sales: SalesRow[];
  refunds: RefundRow[];
  departments: { sold: { department: DepartmentKey; amount: Prisma.Decimal }[]; returned: { department: DepartmentKey; amount: Prisma.Decimal }[] };
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

type Grouped = { day: string; hour: unknown; type: OrderType };

// Instants → the business day and the clock hour, in SQL: the zone's offset
// (Lagos: +60, no daylight saving) and the day start.
function shifts(period: Pick<ReportPeriod, "start">, dayStartMinutes: number) {
  const zone = appZoneOffsetMinutes(period.start);
  return { zone, day: zone - dayStartMinutes };
}

async function salesRows(period: ReportPeriod, filters: ReportFilters, dayStartMinutes: number): Promise<SalesRow[]> {
  const shift = shifts(period, dayStartMinutes);
  const rows = await prisma.$queryRaw<(Grouped & { orders: unknown; covers: unknown; sales: unknown })[]>`
    SELECT DATE_FORMAT(DATE_ADD(o.closedAt, INTERVAL ${shift.day} MINUTE), '%Y-%m-%d') AS day,
           HOUR(DATE_ADD(o.closedAt, INTERVAL ${shift.zone} MINUTE)) AS hour,
           o.type AS type,
           COUNT(*) AS orders,
           COALESCE(SUM(o.guests), 0) AS covers,
           COALESCE(SUM(s.grandTotal), 0) AS sales
    FROM ${ORDER_SALE}
    WHERE ${orderScopeSql(filters)} AND ${closedIn(period)}
    GROUP BY day, hour, type`;
  return rows.map((r) => ({ day: r.day, hour: int(r.hour), type: r.type, orders: int(r.orders), covers: int(r.covers), sales: dec(r.sales) }));
}

async function refundRows(period: ReportPeriod, filters: ReportFilters, dayStartMinutes: number): Promise<RefundRow[]> {
  const shift = shifts(period, dayStartMinutes);
  const rows = await prisma.$queryRaw<(Grouped & { refunds: unknown })[]>`
    SELECT DATE_FORMAT(DATE_ADD(r.createdAt, INTERVAL ${shift.day} MINUTE), '%Y-%m-%d') AS day,
           HOUR(DATE_ADD(r.createdAt, INTERVAL ${shift.zone} MINUTE)) AS hour,
           o.type AS type,
           COALESCE(SUM(r.grandTotal), 0) AS refunds
    FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId
    WHERE r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}
    GROUP BY day, hour, type`;
  return rows.map((r) => ({ day: r.day, hour: int(r.hour), type: r.type, refunds: dec(r.refunds) }));
}

async function tipsOf(period: ReportPeriod, filters: ReportFilters): Promise<Prisma.Decimal> {
  const [row] = await prisma.$queryRaw<{ tips: unknown }[]>`
    SELECT COALESCE(SUM(t.amount), 0) AS tips
    FROM OrderTip t JOIN ${ORDER_SALE} ON o.id = t.orderId
    WHERE t.deletedAt IS NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}`;
  return dec(row?.tips);
}

// Lines that were sold: billed (sent, not cancelled or removed), not remakes.
async function costOf(period: ReportPeriod, filters: ReportFilters): Promise<CostSum> {
  const [row] = await prisma.$queryRaw<{ cost: unknown; quantity: unknown; missing: unknown }[]>`
    SELECT COALESCE(SUM(i.quantity * i.unitCost), 0) AS cost,
           COALESCE(SUM(i.quantity), 0) AS quantity,
           COALESCE(SUM(CASE WHEN i.unitCost IS NULL THEN i.quantity ELSE 0 END), 0) AS missing
    FROM OrderItem i JOIN ${ORDER_SALE} ON o.id = i.orderId
    WHERE i.deletedAt IS NULL AND i.cancelledAt IS NULL AND i.kitchenStatus <> 'NEW' AND i.remakeOfId IS NULL
      AND ${orderScopeSql(filters)} AND ${closedIn(period)}`;
  return { cost: dec(row?.cost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP), quantity: int(row?.quantity), missingQuantity: int(row?.missing) };
}

async function wasteOf(period: ReportPeriod): Promise<{ waste: Prisma.Decimal; entries: number }> {
  const [row] = await prisma.$queryRaw<{ waste: unknown; entries: unknown }[]>`
    SELECT COALESCE(SUM(w.costSnapshot), 0) AS waste, COUNT(*) AS entries
    FROM WasteEntry w
    WHERE w.businessId = ${BUSINESS_SETTINGS_ID} AND w.status = 'ACTIVE' AND w.deletedAt IS NULL
      AND w.createdAt >= ${period.start} AND w.createdAt < ${period.end}`;
  return { waste: dec(row?.waste), entries: int(row?.entries) };
}

async function departmentsOf(period: ReportPeriod, filters: ReportFilters): Promise<OverviewData["departments"]> {
  const [sold, returned] = await Promise.all([
    prisma.$queryRaw<{ department: DepartmentKey; amount: unknown }[]>`
      SELECT COALESCE(mg.department, 'NONE') AS department, COALESCE(SUM(si.subtotal), 0) AS amount
      FROM SaleItem si JOIN ${ORDER_SALE} ON o.saleId = si.saleId
        JOIN Product p ON p.id = si.productId LEFT JOIN MenuGroup mg ON mg.id = p.menuGroupId
      WHERE ${orderScopeSql(filters)} AND ${closedIn(period)}
      GROUP BY department`,
    prisma.$queryRaw<{ department: DepartmentKey; amount: unknown }[]>`
      SELECT COALESCE(mg.department, 'NONE') AS department, COALESCE(SUM(ri.subtotal), 0) AS amount
      FROM SaleReturnItem ri JOIN SaleReturn r ON r.id = ri.returnId JOIN ${ORDER_SALE} ON o.saleId = r.saleId
        JOIN Product p ON p.id = ri.productId LEFT JOIN MenuGroup mg ON mg.id = p.menuGroupId
      WHERE r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}
      GROUP BY department`,
  ]);
  const shape = (rows: { department: DepartmentKey; amount: unknown }[]) => rows.map((r) => ({ department: r.department, amount: dec(r.amount) }));
  return { sold: shape(sold), returned: shape(returned) };
}

async function periodTotals(period: ReportPeriod, filters: ReportFilters, dayStartMinutes: number, withCost: boolean) {
  const [sales, refunds, tips, cost, waste] = await Promise.all([
    salesRows(period, filters, dayStartMinutes),
    refundRows(period, filters, dayStartMinutes),
    tipsOf(period, filters),
    withCost ? costOf(period, filters) : Promise.resolve(null),
    wasteOf(period),
  ]);
  return { sales, refunds, totals: totalsOf({ sales, refunds, tips, waste: waste.waste, wasteEntries: waste.entries, cost }) };
}

// The period and the equal one before it (the tiles' change). `withCost`:
// the viewer has View Cost — otherwise cost isn't worked out at all.
export async function getOverview(window: ReportWindow, filters: ReportFilters, options: { dayStartMinutes: number; withCost: boolean }): Promise<ReportResult<OverviewData>> {
  try {
    const [current, previous, departments] = await Promise.all([
      periodTotals(window, filters, options.dayStartMinutes, options.withCost),
      periodTotals(window.previous, filters, options.dayStartMinutes, options.withCost),
      departmentsOf(window, filters),
    ]);
    return { ok: true, data: { current: current.totals, previous: previous.totals, sales: current.sales, refunds: current.refunds, departments } };
  } catch (error) {
    console.error("[restaurant] reports: overview failed:", error);
    return { ok: false, error: "The overview couldn't be loaded. Please try again." };
  }
}
