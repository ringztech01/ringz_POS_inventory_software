import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { formatPrepTime } from "../../lib/dashboard";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";
import { typeLines, type TypeLine } from "../../lib/reportTables";
import type { OrderTypeData } from "../../server/queries/reports/tables";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";

export const COLUMNS: SortableColumn[] = [
  { key: "type", label: "Order type", width: "minmax(160px,1fr)" },
  { key: "orders", label: "Orders", width: "100px", align: "right" },
  { key: "net", label: "Net sales", width: "140px", align: "right" },
  { key: "averageBill", label: "Average bill", width: "130px", align: "right" },
  { key: "share", label: "% of sales", width: "110px", align: "right" },
  { key: "prep", label: "Avg prep time", width: "130px", align: "right", title: "Its lines, sent to the kitchen → Ready (as Prep times)" },
];

const money = (v: string | null) => (v === null ? "—" : formatNaira(v));
const cells = (l: Omit<TypeLine, "type">, name: string): Record<string, string> => ({
  type: name,
  orders: String(l.orders),
  net: money(l.net),
  averageBill: money(l.averageBill),
  share: l.share === null ? "—" : `${l.share.toFixed(1)}%`,
  prep: l.prepSeconds === null ? "—" : formatPrepTime(l.prepSeconds),
});

// Restaurant Reports › By order type (Step 5): Dine-in, Takeaway, Bar tab,
// Delivery — each always shown.
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function orderTypeTables({ data }: { data: OrderTypeData }) {
  const { lines, totals } = typeLines(data);
  const rows: SortableRow[] = lines.map((l) => ({
    id: l.type,
    cells: cells(l, ORDER_TYPE_LABEL[l.type]),
    sort: { type: ORDER_TYPE_LABEL[l.type].toLowerCase(), orders: l.orders, net: Number(l.net), averageBill: l.averageBill === null ? null : Number(l.averageBill), share: l.share, prep: l.prepSeconds },
  }));
  return { lines, totals, rows };
}

export default function OrderTypeReport({ data }: { data: OrderTypeData }) {
  const { totals, rows } = orderTypeTables({ data });

  return (
    <div data-type-report style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SortableTable columns={COLUMNS} rows={rows} totals={cells(totals, "Total")} defaultSort="net" textColumns={["type"]} data="type" />
      <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Prep time: each order type&apos;s lines from Send to Ready, as in Prep times. Net sales take off refunds made in the period.</span>
    </div>
  );
}
