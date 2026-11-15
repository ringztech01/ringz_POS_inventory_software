import { Banknote, ClipboardList, CookingPot, HandCoins, ReceiptText, Trash2, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import DonutCard from "@/components/dashboard/DonutCard";
import { averageBill, countDeltaNote, hourChart, moneyDeltaNote, percentNote } from "../../lib/dashboard";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";
import { ORDER_TYPE_COLOR } from "../../lib/theme";
import { DEPARTMENT_COLOR as POS_DEPARTMENT_COLOR } from "../../lib/posGrid";
import { bestDayOf, DEPARTMENT_LABEL, foodCostPercent, netByDay, netByDepartment, netByHour, netByType, perCover, pointsNote, previousName } from "../../lib/reportOverview";
import type { ReportFilters, ReportWindow } from "../../server/queries/reports/filters";
import type { OverviewData } from "../../server/queries/reports/overview";
import DashboardCard from "../dashboard/DashboardCard";
import KpiTile from "../dashboard/KpiTile";
import SalesByHour from "../dashboard/SalesByHour";
import SalesByDayChart from "./SalesByDayChart";

// Food and Bar in the touch POS's department colours; not on a button, grey.
const DEPARTMENT_COLOR = { ...POS_DEPARTMENT_COLOR, NONE: "#9aa3a6" } as const;

const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const shortDay = (day: string) => dayLabel.format(new Date(`${day}T00:00:00.000Z`)).replace(",", "");

function Note({ children, tone = "plain", data }: { children: ReactNode; tone?: "plain" | "warn"; data: string }) {
  return (
    <p data-overview-note={data} style={{ margin: 0, fontSize: 12.5, color: tone === "warn" ? "#8a5a00" : COLORS.slateMid }}>
      {children}
    </p>
  );
}

// Restaurant Reports › Overview (Step 2): the KPI strip, each tile against
// the equal period before; sales by hour and by day; the order type and
// Food / Bar splits; the peak hour and best day. Food cost % only with View
// Cost. Amounts come as Decimals and are formatted here.
export default function OverviewReport({ data, window, filters, withCost }: { data: OverviewData; window: ReportWindow; filters: ReportFilters; withCost: boolean }) {
  const { current: now, previous: before } = data;
  const vs = previousName(window.days);
  const avgNow = averageBill(now.sales, now.orders);
  const avgBefore = averageBill(before.sales, before.orders);
  const coverNow = perCover(now.sales, now.covers);
  const coverBefore = perCover(before.sales, before.covers);
  const costPctNow = now.cost ? foodCostPercent(now.cost.total, now.net) : null;
  const costPctBefore = before.cost ? foodCostPercent(before.cost.total, before.net) : null;

  const hours = hourChart(netByHour(data.sales, data.refunds));
  const days = netByDay(window, data.sales, data.refunds);
  const best = bestDayOf(days);
  const types = netByType(data.sales, data.refunds);
  const departments = netByDepartment(data.departments.sold, data.departments.returned);
  const filtered = Object.values(filters).some(Boolean);
  const nextHour = (label: string) => `${String((Number(label.slice(0, 2)) + 1) % 24).padStart(2, "0")}:00`;

  return (
    <div data-overview style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
        <KpiTile label="Net sales" tone="teal" icon={Banknote} value={formatNaira(now.net.toFixed(2))} note={percentNote(now.net, before.net, vs)} />
        <KpiTile label="Orders" tone="blue" icon={ReceiptText} value={String(now.orders)} note={countDeltaNote(now.orders, before.orders, vs)} />
        <KpiTile label="Covers" tone="violet" icon={Users} value={String(now.covers)} note={countDeltaNote(now.covers, before.covers, vs)} />
        <KpiTile label="Average bill" tone="cyan" icon={ClipboardList} value={formatNaira(avgNow)} note={moneyDeltaNote(avgNow, avgBefore, vs)} />
        <KpiTile label="Average per cover" tone="green" icon={UserRound} value={formatNaira(coverNow)} note={moneyDeltaNote(coverNow, coverBefore, vs)} />
        {withCost && <KpiTile label="Food cost %" tone="amber" icon={CookingPot} value={costPctNow === null ? "—" : `${costPctNow.toFixed(1)}%`} note={pointsNote(costPctNow, costPctBefore, vs)} />}
        <KpiTile label="Waste cost" tone="rose" icon={Trash2} value={formatNaira(now.waste.toFixed(2))} note={percentNote(now.waste, before.waste, vs)} />
        <KpiTile label="Tips" tone="orange" icon={HandCoins} value={formatNaira(now.tips.toFixed(2))} note={percentNote(now.tips, before.tips, vs)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {!now.refunds.isZero() && (
          <Note data="refunds">
            Net sales: {formatNaira(now.sales.toFixed(2))} of bills settled, less {formatNaira(now.refunds.toFixed(2))} refunded in this period. Tips are never part of net sales.
          </Note>
        )}
        {withCost && now.cost && now.cost.missingQuantity > 0 && (
          <Note data="no-cost" tone="warn">
            {now.cost.missingQuantity} of {now.cost.quantity} items sold had no cost (the item or one of its ingredients has none), so food cost leaves them out.
          </Note>
        )}
        {filtered && <Note data="waste-unfiltered">Waste cost is all waste logged in the period: waste isn&apos;t tied to an area, waiter, order type, station or device.</Note>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}>
        <SalesByHour chart={hours} />
        <DonutCard
          title="Order type"
          legend
          cutout="58%"
          slices={types.filter((t) => Number(t.net) > 0).map((t) => ({ label: ORDER_TYPE_LABEL[t.type], value: Number(t.net), color: ORDER_TYPE_COLOR[t.type], detail: `${t.orders} ${t.orders === 1 ? "order" : "orders"} · ${formatNaira(t.net)}` }))}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}>
        <DashboardCard title="Sales by day">
          <SalesByDayChart days={days.map((d) => ({ ...d, label: shortDay(d.day) }))} />
        </DashboardCard>
        <DonutCard
          title="Food vs Bar"
          headerExtra={<span style={{ fontSize: 12, color: COLORS.slateMid }}>Item sales</span>}
          legend
          cutout="58%"
          slices={departments.filter((d) => Number(d.net) > 0).map((d) => ({ label: DEPARTMENT_LABEL[d.department], value: Number(d.net), color: DEPARTMENT_COLOR[d.department], detail: formatNaira(d.net) }))}
        />
      </div>

      <p data-overview-callout style={{ margin: 0, fontSize: 13.5, color: COLORS.text }}>
        {hours.peak ? (
          <>
            Peak hour <strong>{hours.peak.label}–{nextHour(hours.peak.label)}</strong> ({formatNaira(hours.peak.total)})
          </>
        ) : (
          "No peak hour yet"
        )}
        {" · "}
        {best ? (
          <>
            Best day <strong>{shortDay(best.day)}</strong> ({formatNaira(best.total)})
          </>
        ) : (
          "no best day yet"
        )}
        .
      </p>
    </div>
  );
}
