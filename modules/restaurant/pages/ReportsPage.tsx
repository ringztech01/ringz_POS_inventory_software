import { BarChart3, CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { dayStartLabel, reportDayLabel as day, REPORT_TABS, type ReportTabKey } from "../lib/reportTabs";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { keepKnown, parseReportFilters, PRESET_LABELS, reportPresets, type ReportPresetKey } from "../server/queries/reports/filters";
import { countSettledOrders, getReportSetup } from "../server/queries/reports/shell";
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

// /restaurant/reports[/<tab>] — Restaurant Reports (Step 1: the shell). The
// tabs, the shared filter bar (all in the URL) and, for now, how many
// settled orders the filters match. Back office: Restaurant Reports, which
// the Service-only roles never have (Part 6f). Read-only.
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
  // Always the dates themselves ("Wed 11 Nov"), after the quick range's name.
  const days = window.from === window.to ? day(window.from) : `${day(window.from)} – ${day(window.to)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Reports</h1>
        <span data-report-period style={{ fontSize: 13, color: COLORS.slateMid }}>
          {window.preset ? `${PRESET_LABELS[window.preset]} · ` : ""}
          {days}
          {dayStartMinutes ? ` · business day starts ${dayStartLabel(dayStartMinutes)}` : ""}
        </span>
      </div>

      <ReportsTabBar active={tab} />

      <ReportFilterBar
        presets={(Object.keys(presets) as ReportPresetKey[]).map((key) => ({ label: PRESET_LABELS[key], range: presets[key] }))}
        current={{ from: window.from, to: window.to }}
        values={filters}
        areas={areas}
        waiters={waiters}
        stations={stations}
        devices={devices}
      />

      {!count.ok ? (
        <Notice data="error" tone="error" icon={<CircleAlert size={19} strokeWidth={1.6} />}>
          {count.error}
        </Notice>
      ) : count.data === 0 ? (
        <Notice data="empty" icon={<Inbox size={19} strokeWidth={1.6} />}>
          No settled orders for this period.
        </Notice>
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
