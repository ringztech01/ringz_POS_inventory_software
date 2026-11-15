import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { formatHours, waiterLines, type WaiterLine } from "../../lib/reportWaiters";
import { formatOpenFor } from "../../lib/time";
import type { WaiterData } from "../../server/queries/reports/waiters";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";

export const COLUMNS: SortableColumn[] = [
  { key: "name", label: "Waiter", width: "minmax(170px,1.4fr)" },
  { key: "orders", label: "Orders", width: "80px", align: "right" },
  { key: "covers", label: "Covers", width: "80px", align: "right" },
  { key: "net", label: "Net sales", width: "120px", align: "right" },
  { key: "averageBill", label: "Average bill", width: "110px", align: "right" },
  { key: "tips", label: "Tips", width: "100px", align: "right" },
  { key: "discounts", label: "Discounts given", width: "140px", align: "right", title: "Bills they put a discount on: how many, and how much" },
  { key: "voids", label: "Voids", width: "130px", align: "right", title: "Sent lines they voided: how many, and their value" },
  { key: "overrides", label: "Manager overrides", width: "130px", align: "right", title: "Times a manager's PIN approved something for them" },
  { key: "tableTime", label: "Avg table time", width: "120px", align: "right", title: "Opened → closed, on average" },
  { key: "hours", label: "Hours on shift", width: "110px", align: "right", title: "Clock in → clock out in the period" },
  { key: "perHour", label: "Sales per hour", width: "120px", align: "right", title: "Net sales ÷ hours on shift" },
];

const money = (v: string | null) => (v === null ? "—" : formatNaira(v));
const countAndMoney = (n: number, v: string) => (n === 0 ? "—" : `${n} · ${formatNaira(v)}`);

function cells(l: WaiterLine): Record<string, string> {
  return {
    name: l.name,
    orders: String(l.orders),
    covers: String(l.covers),
    net: money(l.net),
    averageBill: money(l.averageBill),
    tips: money(l.tips),
    discounts: countAndMoney(l.discounts, l.discountAmount),
    voids: countAndMoney(l.voids, l.voidValue),
    overrides: String(l.overrides),
    tableTime: l.averageTableSeconds === null ? "—" : formatOpenFor(Math.round(l.averageTableSeconds / 60)),
    hours: l.shiftSeconds === null ? "—" : formatHours(l.shiftSeconds),
    perHour: money(l.salesPerHour),
  };
}

// Restaurant Reports › By waiter (Step 4). A waiter's name filters the whole
// report to them (every tab, through the URL).
// The table: its settings, rows (cells and sort values) and lines — the
// page and the Excel export (server/reportExport.ts) both use it.
export const WAITER_TABLE = { columns: COLUMNS, defaultSort: "net", textColumns: ["name"], param: "" } as const;
export function waiterTable(data: WaiterData, knownWaiters: ReadonlySet<string> = new Set(), filteredTo: string | null = null) {
  const { lines, totals } = waiterLines(data);
  const rows: SortableRow[] = lines.map((l) => ({
    id: l.userId ?? "none",
    cells: cells(l),
    sort: {
      name: l.name.toLowerCase(),
      orders: l.orders,
      covers: l.covers,
      net: Number(l.net),
      averageBill: l.averageBill === null ? null : Number(l.averageBill),
      tips: Number(l.tips),
      discounts: Number(l.discountAmount),
      voids: Number(l.voidValue),
      overrides: l.overrides,
      tableTime: l.averageTableSeconds,
      hours: l.shiftSeconds,
      perHour: l.salesPerHour === null ? null : Number(l.salesPerHour),
    },
    filter: l.userId && knownWaiters.has(l.userId) && filteredTo !== l.userId ? { param: "waiter", value: l.userId, title: `Show only ${l.name}'s orders, on every tab` } : null,
  }));
  return { lines, totals, rows };
}

export default function WaiterReport({ data, knownWaiters, filteredTo, clockInOut }: { data: WaiterData; knownWaiters: ReadonlySet<string>; filteredTo: string | null; clockInOut: boolean }) {
  const { lines, totals, rows } = waiterTable(data, knownWaiters, filteredTo);
  const anyShift = lines.some((l) => l.shiftSeconds !== null);
  return (
    <div data-waiter-report style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 13, color: COLORS.slateMid }}>
        {lines.length} {lines.length === 1 ? "person" : "people"}
        {filteredTo ? "" : " · click a waiter to see only their orders on every tab"}
      </span>
      <SortableTable columns={COLUMNS} rows={rows} totals={{ ...cells(totals), name: "Total" }} defaultSort={WAITER_TABLE.defaultSort} textColumns={[...WAITER_TABLE.textColumns]} data="waiter" />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: COLORS.slateMid }}>
        <span data-waiter-note="attribution">
          Orders, covers, net sales, average bill, table time and tips are the settled orders each person waited. Discounts given are credited to whoever applied them, voids to whoever voided the line (when it was voided), and overrides to the person a manager approved something for.
        </span>
        <span data-waiter-note="shifts">
          {anyShift ? "Hours on shift: clock in to clock out within the period (a shift still open counts up to now)." : clockInOut ? "No shifts were clocked in this period." : "Hours on shift need Clock in / out (Settings › Staff), which is off."}
        </span>
      </div>
    </div>
  );
}
