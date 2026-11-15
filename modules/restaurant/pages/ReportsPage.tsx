import { BarChart3, CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { dayStartLabel, reportDayLabel as day, REPORT_TABS, type ReportTabKey } from "../lib/reportTabs";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { keepKnown, parseReportFilters, PRESET_LABELS, reportPresets, type ReportPresetKey } from "../server/queries/reports/filters";
import { countSettledOrders, getReportSetup } from "../server/queries/reports/shell";
import { getOverview } from "../server/queries/reports/overview";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import OverviewReport from "../components/reports/OverviewReport";
import { getDishReport, type DishData } from "../server/queries/reports/dishes";
import { dishLines } from "../lib/reportDishes";
import { formatAppDateTime } from "../lib/time";
import DishReport from "../components/reports/DishReport";
import { getWaiterReport } from "../server/queries/reports/waiters";
import WaiterReport from "../components/reports/WaiterReport";
import { getOrderTypeReport, getTableReport } from "../server/queries/reports/tables";
import TableReport from "../components/reports/TableReport";
import OrderTypeReport from "../components/reports/OrderTypeReport";
import { getPaymentsReport } from "../server/queries/reports/payments";
import PaymentsReport from "../components/reports/PaymentsReport";
import { getWasteReport } from "../server/queries/reports/waste";
import WasteReport from "../components/reports/WasteReport";
import { getVoidsReport } from "../server/queries/reports/voids";
import VoidsReport from "../components/reports/VoidsReport";
import { getShiftsReport } from "../server/queries/reports/shifts";
import ShiftsReport from "../components/reports/ShiftsReport";
import ReportActions from "../components/reports/ReportActions";
import { businessName } from "../server/reportExportRoute";
import { REPORTS } from "@/lib/hardware/assignments";
import { formatAppDateTime as stamp } from "../lib/time";
import { ORDER_TYPE_LABELS } from "../lib/reportTabs";

// Print (A4): only the report, laid out for the page — no sidebar, top bar,
// tabs, filter bar or buttons; wide tables shown whole, a little smaller.
const PRINT_CSS = `
@page { size: A4 landscape; margin: 10mm; }
[data-report-print-only] { display: none; }
@media print {
  body * { visibility: hidden !important; }
  [data-report-print], [data-report-print] * { visibility: visible !important; }
  [data-report-print] { position: absolute; left: 0; top: 0; width: 100%; zoom: 0.72; }
  [data-no-print] { display: none !important; }
  p[data-report-print-only] { display: block !important; }
  span[data-report-print-only] { display: inline !important; }
  [data-report-print] div { overflow: visible !important; }
  [data-report-table] { min-width: 0 !important; }
  [data-report-print] section, [data-report-print] [data-report-table] > div { break-inside: avoid; }
}`;
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import ReportFilterBar from "../components/reports/ReportFilterBar";
import ReportsTabBar from "../components/reports/ReportsTabBar";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const card = { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(23,27,28,.06)" } as const;

function Notice({ icon, children, tone = "plain", data }: { icon: ReactNode; children: ReactNode; tone?: "plain" | "error"; data: string }) {
  return (
    <div data-report-state={data} style={{ ...card, padding: "44px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, background: tone === "error" ? "#fdecea" : COLORS.bgApp, color: tone === "error" ? "#b3261e" : COLORS.slateLight, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
      <span style={{ fontSize: 13.5, color: tone === "error" ? "#b3261e" : COLORS.slateMid }}>{children}</span>
    </div>
  );
}

// /restaurant/reports[/<tab>] — Restaurant Reports. The tabs, the shared
// filter bar (all in the URL), then the tab: Overview (Step 2); the others,
// for now, how many settled orders the filters match. Back office:
// Restaurant Reports, which the Service-only roles never have (Part 6f).
// Cost figures only with View Cost — not even worked out otherwise.
// Read-only.
export default async function ReportsPage({ tab, searchParams }: { tab: ReportTabKey; searchParams: SearchParams }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_REPORTS);
  if (denied) return denied;

  const title = REPORT_TABS.find((t) => t.key === tab)!.label;
  const setup = await getReportSetup();
  if (!setup.ok) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Reports</h1>
        <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
          {setup.error}
        </Notice>
      </div>
    );
  }

  const { dayStartMinutes, areas, waiters, stations, devices } = setup.data;
  const parsed = parseReportFilters(await searchParams, { dayStartMinutes });
  const filters = keepKnown(parsed.filters, { areas: areas.map((a) => a.id), waiters: waiters.map((w) => w.id), stations: stations.map((s) => s.id), devices: devices.map((d) => d.id) });
  const { window } = parsed;
  const presets = reportPresets(new Date(), dayStartMinutes);
  const count = await countSettledOrders(window, filters);
  const viewer = (await getCurrentUserPermissions()).permissions;
  const withCost = viewer.has(RESTAURANT_PERMISSIONS.VIEW_COST);
  const hasOrders = count.ok && count.data > 0;
  const overview = tab === "overview" && hasOrders ? await getOverview(window, filters, { dayStartMinutes, withCost }) : null;
  const dishes = tab === "dishes" && hasOrders ? await getDishReport(window, filters, { withCost }) : null;
  const waiterReport = tab === "waiters" && hasOrders ? await getWaiterReport(window, filters) : null;
  const tableReport = tab === "tables" && hasOrders ? await getTableReport(window, filters) : null;
  const typeReport = tab === "order-types" && hasOrders ? await getOrderTypeReport(window, filters) : null;
  const paymentsReport = tab === "payments" && hasOrders ? await getPaymentsReport(window, filters) : null;
  // Waste isn't about settled orders: its tab loads either way.
  const wasteReport = tab === "waste" && count.ok ? await getWasteReport(window, { dayStartMinutes, withCost }) : null;
  // Voids happen on orders not yet (or never) settled: this tab loads either way too.
  const voidsReport = tab === "voids" && count.ok ? await getVoidsReport(window, filters) : null;
  // Shifts and tills aren't settled orders either.
  const shiftsReport = tab === "shifts" && count.ok ? await getShiftsReport(window, filters) : null;
  // For Print: the Reports printer (Part 6d) to pick, and the page's header.
  const [reportsPrinter, me, business] = await Promise.all([
    prisma.printerAssignment.findFirst({ where: { role: REPORTS, printer: { deletedAt: null } }, select: { printer: { select: { name: true } } } }),
    prisma.user.findUnique({ where: { id: (await getCurrentUserPermissions()).userId ?? "" }, select: { displayName: true, firstName: true, lastName: true } }),
    businessName(),
  ]);
  const named = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "";
  const filterText = [
    filters.area && `Dining area: ${named(areas, filters.area)}`,
    filters.waiter && `Waiter: ${named(waiters, filters.waiter)}`,
    filters.type && `Order type: ${ORDER_TYPE_LABELS[filters.type]}`,
    filters.station && `Station: ${named(stations, filters.station)}`,
    filters.device && `Device: ${named(devices, filters.device)}`,
  ].filter(Boolean).join(" · ") || "No filters";
  const clockInOut = tab === "waiters" || tab === "shifts" ? ((await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantClockInOut: true } }))?.restaurantClockInOut ?? false) : false;
  // Always the dates themselves ("Wed 11 Nov"), after the quick range's name.
  const days = window.from === window.to ? day(window.from) : `${day(window.from)} – ${day(window.to)}`;

  return (
    <div data-report-print style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>
          Reports<span data-report-print-only> · {title}</span>
        </h1>
        <span data-report-period style={{ fontSize: 13, color: COLORS.slateMid }}>
          {window.preset ? `${PRESET_LABELS[window.preset]} · ` : ""}
          {days}
          {dayStartMinutes ? ` · business day starts ${dayStartLabel(dayStartMinutes)}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <ReportActions tab={tab} reportsPrinter={reportsPrinter?.printer.name ?? null} />
      </div>
      <p data-report-print-only style={{ margin: 0, fontSize: 12, color: COLORS.slate }}>
        {business} · {filterText} · Printed {stamp(new Date())}
        {me ? ` by ${me.displayName || `${me.firstName} ${me.lastName}`.trim()}` : ""}
      </p>

      <div data-no-print>
        <ReportsTabBar active={tab} />
      </div>

      <div data-no-print>
      <ReportFilterBar
        presets={(Object.keys(presets) as ReportPresetKey[]).map((key) => ({ label: PRESET_LABELS[key], range: presets[key] }))}
        current={{ from: window.from, to: window.to }}
        values={filters}
        areas={areas}
        waiters={waiters}
        stations={stations}
        devices={devices}
      />
      </div>

      {!count.ok ? (
        <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
          {count.error}
        </Notice>
      ) : shiftsReport ? (
        shiftsReport.ok ? (
          <ShiftsReport data={shiftsReport.data} clockInOut={clockInOut} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {shiftsReport.error}
          </Notice>
        )
      ) : voidsReport ? (
        voidsReport.ok ? (
          <VoidsReport data={voidsReport.data} window={window} canAudit={viewer.has(RESTAURANT_PERMISSIONS.VIEW_AUDIT_LOG)} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {voidsReport.error}
          </Notice>
        )
      ) : wasteReport ? (
        wasteReport.ok ? (
          <WasteReport data={wasteReport.data} window={window} withCost={withCost} filtered={Object.values(filters).some(Boolean)} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {wasteReport.error}
          </Notice>
        )
      ) : count.data === 0 ? (
        <Notice data="empty" icon={<Inbox size={19} strokeWidth={1.6} />}>
          No settled orders for this period.
        </Notice>
      ) : paymentsReport ? (
        paymentsReport.ok ? (
          <PaymentsReport data={paymentsReport.data} knownWaiters={new Set(waiters.map((w) => w.id))} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {paymentsReport.error}
          </Notice>
        )
      ) : tableReport ? (
        tableReport.ok ? (
          <TableReport data={tableReport.data} days={window.days} areaFilter={filters.area} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {tableReport.error}
          </Notice>
        )
      ) : typeReport ? (
        typeReport.ok ? (
          <OrderTypeReport data={typeReport.data} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {typeReport.error}
          </Notice>
        )
      ) : waiterReport ? (
        waiterReport.ok ? (
          <WaiterReport data={waiterReport.data} knownWaiters={new Set(waiters.map((w) => w.id))} filteredTo={filters.waiter} clockInOut={clockInOut} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {waiterReport.error}
          </Notice>
        )
      ) : dishes ? (
        dishes.ok ? (
          <DishesSection data={dishes.data} withCost={withCost} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {dishes.error}
          </Notice>
        )
      ) : overview ? (
        overview.ok ? (
          <OverviewReport data={overview.data} window={window} filters={filters} withCost={withCost} />
        ) : (
          <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
            {overview.error}
          </Notice>
        )
      ) : (
        <Notice data="stub" icon={<BarChart3 size={19} strokeWidth={1.6} />}>
          <span data-report-count={count.data} style={{ display: "block", fontWeight: 600, color: COLORS.ink, marginBottom: 4 }}>
            {count.data} settled {count.data === 1 ? "order" : "orders"} in this period
          </span>
          {title} — coming in the next steps.
        </Notice>
      )}
    </div>
  );
}

// By dish: the table and its notes.
function DishesSection({ data, withCost }: { data: DishData; withCost: boolean }) {
  const { lines, totals } = dishLines({ sales: data.sales, refunds: data.refunds, costs: data.costs, info: data.info, modifiers: data.modifiers, minutes86: data.minutes86 });
  const missing = lines.reduce((n, l) => n + l.costMissing, 0);
  return (
    <DishReport
      lines={lines}
      totals={totals}
      withCost={withCost}
      logSince={data.logSince ? formatAppDateTime(data.logSince) : null}
      notes={
        <>
          <span data-dish-note="discount">Discounts are each dish&apos;s share of its bill&apos;s discount. Net sales take off refunds made in the period; the service charge isn&apos;t part of any dish.</span>
          {withCost && missing > 0 && (
            <span data-dish-note="no-cost" style={{ color: "#8a5a00" }}>
              * {missing} {missing === 1 ? "item" : "items"} sold had no cost (the item or one of its ingredients has none), so food cost and margin leave {missing === 1 ? "it" : "them"} out. Menu engineering doesn&apos;t class those dishes.
            </span>
          )}
        </>
      }
    />
  );
}
