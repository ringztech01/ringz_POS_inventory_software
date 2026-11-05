import { CircleAlert, Clock, CookingPot } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { todayInAppZone } from "@/lib/dateRanges";
import ReportDatePicker from "@/components/reports/ReportDatePicker";
import { formatPrepTime } from "../lib/dashboard";
import { lateRateText, readPrepFilter } from "../lib/prepTimes";
import { dayLabel } from "../lib/time";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getPrepTimeReport, getReportStations } from "../server/queries/prepTimes";
import KpiTile from "../components/dashboard/KpiTile";
import PrepStationFilter from "../components/reports/PrepStationFilter";
import PrepTable from "../components/reports/PrepTable";

// /restaurant/reports/prep-times[?from&to&station] — how long the kitchen
// takes: dishes that became Ready in the range (default the last 7 days,
// to the end of the last day), all stations or one. Needs Restaurant Reports.
export default async function PrepTimesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; station?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_REPORTS);
  if (denied) return denied;

  const stations = await getReportStations();
  const { range, stationId } = readPrepFilter(await searchParams, stations.map((s) => s.id));
  const report = await getPrepTimeReport(range, stationId);
  const { summary } = report;
  const today = todayInAppZone();
  const days = range.from === range.to ? dayLabel(range.from, today) : `${dayLabel(range.from, today)} – ${dayLabel(range.to, today)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Prep times</h1>
        <span data-range style={{ fontSize: 13, color: COLORS.slateMid }}>
          {days} · {stationId ? stations.find((s) => s.id === stationId)?.name : "All stations"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <ReportDatePicker />
        <PrepStationFilter stations={stations} value={stationId ?? ""} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
        <KpiTile label="Items cooked" tone="teal" icon={CookingPot} value={String(summary.quantity)} note={`${summary.lines} ${summary.lines === 1 ? "line" : "lines"} made Ready`} />
        <KpiTile
          label="Avg sent → ready"
          tone="green"
          icon={Clock}
          value={summary.avgTotal === null ? "—" : formatPrepTime(summary.avgTotal)}
          note={summary.maxTotal === null ? "Nothing cooked yet" : `Slowest ${formatPrepTime(summary.maxTotal)}`}
        />
        <KpiTile
          label="Over the late limit"
          tone="rose"
          icon={CircleAlert}
          value={lateRateText(summary.late, summary.lines)}
          note={`${summary.late} of ${summary.lines} ${summary.lines === 1 ? "line" : "lines"} past their station's limit`}
        />
      </div>

      <PrepTable title="By station" first="Station" rows={report.byStation} empty="Nothing cooked in this period." />
      <PrepTable title="By dish (slowest first)" first="Dish" rows={report.byDish} empty="Nothing cooked in this period." />
    </div>
  );
}
