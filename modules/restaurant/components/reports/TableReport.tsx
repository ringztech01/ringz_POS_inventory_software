import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { heatOf, tableLines, type TableLine, type TableTotals } from "../../lib/reportTables";
import { formatOpenFor } from "../../lib/time";
import type { TableData } from "../../server/queries/reports/tables";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";
import TableHeatMap, { type HeatValues } from "./TableHeatMap";

export const COLUMNS: SortableColumn[] = [
  { key: "name", label: "Table", width: "minmax(140px,1fr)" },
  { key: "area", label: "Area", width: "minmax(130px,1fr)" },
  { key: "orders", label: "Orders", width: "90px", align: "right" },
  { key: "covers", label: "Covers", width: "90px", align: "right" },
  { key: "net", label: "Net sales", width: "130px", align: "right" },
  { key: "averageBill", label: "Average bill", width: "120px", align: "right" },
  { key: "turnTime", label: "Avg turn time", width: "120px", align: "right", title: "Opened → closed, on average" },
  { key: "turns", label: "Turns per day", width: "120px", align: "right", title: "Orders ÷ days in the period" },
];

const money = (v: string | null) => (v === null ? "—" : formatNaira(v));
const minutes = (s: number | null) => (s === null ? "—" : formatOpenFor(Math.round(s / 60)));
const cells = (t: TableTotals & { name?: string; area?: string }): Record<string, string> => ({
  name: t.name ?? "",
  area: t.area ?? "",
  orders: String(t.orders),
  covers: String(t.covers),
  net: money(t.net),
  averageBill: money(t.averageBill),
  turnTime: minutes(t.averageTurnSeconds),
  turns: t.turnsPerDay.toFixed(1),
});
// Compact on the map: ₦1.2M, ₦85.4K, ₦920.
const compact = (v: number) => `₦${new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;

// Restaurant Reports › By table (Step 5): every table with settled orders in
// the period, grouped by dining area with subtotals, and the floor heat map.
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function tableReportTables({ data, days }: { data: TableData; days: number }) {
  const { lines, areas, totals } = tableLines({ orders: data.orders, refunds: data.refunds, info: data.info, days });
  const rows: SortableRow[] = lines.map((l: TableLine) => ({
    id: l.tableId,
    group: l.areaId,
    cells: cells({ ...l, name: l.deleted ? `${l.name} (removed)` : l.name }),
    sort: { name: l.name.toLowerCase(), area: l.area.toLowerCase(), orders: l.orders, covers: l.covers, net: Number(l.net), averageBill: l.averageBill === null ? null : Number(l.averageBill), turnTime: l.averageTurnSeconds, turns: l.turnsPerDay },
  }));
  const net = heatOf(lines, "net");
  const turns = heatOf(lines, "turns");
  const values: HeatValues = { net: {}, turns: {} };
  for (const l of lines) {
    values.net[l.tableId] = { share: net.get(l.tableId)!.share, label: compact(Number(l.net)) };
    values.turns[l.tableId] = { share: turns.get(l.tableId)!.share, label: `${l.turnsPerDay.toFixed(1)}/day` };
  }
  const busiestArea = areas.slice().sort((a, b) => Number(b.totals.net) - Number(a.totals.net))[0]?.areaId ?? null;
  return { lines, areas, totals, rows, net, turns, values, busiestArea };
}

export default function TableReport({ data, days, areaFilter }: { data: TableData; days: number; areaFilter: string | null }) {
  const { areas, totals, rows, values, busiestArea } = tableReportTables({ data, days });

  return (
    <div data-table-report style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SortableTable
        columns={COLUMNS}
        rows={rows}
        totals={cells({ ...totals, name: "Total" })}
        defaultSort="net"
        textColumns={["name", "area"]}
        data="table"
        groups={areas.map((a) => ({ key: a.areaId, label: a.area, totals: cells({ ...a.totals, name: a.area }) }))}
        groupToggle="Group by area"
      />
      <span data-table-note style={{ fontSize: 12.5, color: COLORS.slateMid }}>
        Only orders at a table: takeaways, bar tabs and deliveries are in By order type. An area&apos;s turns per day are its tables&apos; average.
      </span>
      <TableHeatMap areas={data.heat} values={values} defaultArea={areaFilter ?? busiestArea} />
    </div>
  );
}
