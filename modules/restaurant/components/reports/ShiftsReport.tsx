import type { ReactNode } from "react";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { formatHours } from "../../lib/reportWaiters";
import { shiftLines, tillLines, varianceText } from "../../lib/reportShifts";
import { formatAppDateTime } from "../../lib/time";
import type { ShiftsData } from "../../server/queries/reports/shifts";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";
import ZReprintButton from "./ZReprintButton";

const col = (key: string, label: string, width: string, align?: "right"): SortableColumn => ({ key, label, width, align });
export const SHIFT_COLUMNS = [
  col("name", "Staff", "minmax(140px,1fr)"),
  col("role", "Role", "minmax(110px,1fr)"),
  col("in", "Clock in", "140px"),
  col("out", "Clock out", "150px"),
  col("hours", "Hours", "80px", "right"),
  col("orders", "Orders", "80px", "right"),
  col("net", "Net sales", "120px", "right"),
  col("handed", "Handed over", "minmax(150px,1fr)"),
];
export const TILL_COLUMNS = [
  col("device", "Till", "minmax(120px,1fr)"),
  col("opened", "Opened", "140px"),
  col("closed", "Closed", "140px"),
  col("float", "Float", "100px", "right"),
  col("cashSales", "Cash sales", "110px", "right"),
  col("cashRefunds", "Cash refunds", "110px", "right"),
  col("drawer", "Drawer opens", "110px", "right"),
  col("expected", "Expected", "110px", "right"),
  col("counted", "Counted", "110px", "right"),
  col("variance", "Variance", "130px", "right"),
];

function Section({ title, note, children, data }: { title: string; note?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section aria-label={title} data-shifts-section={data} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {children}
      {note && <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{note}</span>}
    </section>
  );
}

// Restaurant Reports › Shifts & cash-up (Step 9).
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function shiftsTables({ data }: { data: ShiftsData }) {
  const shifts = shiftLines(data.shifts);
  const limit = data.varianceLimit.toFixed(2);
  const tills = tillLines(data.tills, data.varianceLimit);

  const shiftRows: SortableRow[] = shifts.lines.map((s) => ({
    id: s.id,
    cells: {
      name: s.name,
      role: s.role ?? "—",
      in: formatAppDateTime(s.startedAt),
      out: s.endedAt ? `${formatAppDateTime(s.endedAt)}${s.autoEnded ? " (auto)" : ""}` : "Still on",
      hours: formatHours(s.seconds),
      orders: String(s.orders),
      net: formatNaira(s.net),
      handed: s.handedOver ? `${s.handedOver} ${s.handedOver === 1 ? "table" : "tables"} to ${s.handedTo ?? "someone"}` : "—",
    },
    sort: { name: s.name.toLowerCase(), role: (s.role ?? "").toLowerCase(), in: s.startedAt.getTime(), out: s.endedAt ? s.endedAt.getTime() : null, hours: s.seconds, orders: s.orders, net: Number(s.net), handed: s.handedOver },
  }));

  const tillRows: SortableRow[] = tills.lines.map((t) => ({
    id: t.id,
    cells: {
      device: t.device,
      opened: `${formatAppDateTime(t.openedAt)} · ${t.openedBy}`,
      closed: t.closedAt ? formatAppDateTime(t.closedAt) : "Still open",
      float: formatNaira(String(t.float)),
      cashSales: formatNaira(String(t.cashSales)),
      cashRefunds: formatNaira(String(t.cashRefunds)),
      drawer: t.drawerByHand ? `${t.drawerOpens} (${t.drawerByHand} by hand)` : String(t.drawerOpens),
      expected: formatNaira(t.expected),
      counted: t.counted === null ? "—" : formatNaira(String(t.counted)),
      variance: t.open ? "Not counted yet" : varianceText(t.variance, formatNaira),
    },
    sort: { device: t.device.toLowerCase(), opened: t.openedAt.getTime(), closed: t.closedAt ? t.closedAt.getTime() : null, float: Number(t.float), cashSales: Number(t.cashSales), cashRefunds: Number(t.cashRefunds), drawer: t.drawerOpens, expected: Number(t.expected), counted: t.counted === null ? null : Number(t.counted), variance: t.variance === null ? null : Math.abs(Number(t.variance)) },
    flag: t.overLimit ? `Out by more than ${formatNaira(limit)}` : null,
    flagTone: "red",
    trailing: t.closedAt ? <ZReprintButton sessionId={t.id} device={t.device} /> : null,
  }));
  return { shifts, limit, tills, shiftRows, tillRows };
}

export default function ShiftsReport({ data, clockInOut }: { data: ShiftsData; clockInOut: boolean }) {
  const { shifts, limit, tills, shiftRows, tillRows } = shiftsTables({ data });

  return (
    <div data-shifts-report style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Section
        title="Shifts"
        data="shifts"
        note={clockInOut ? "Shifts that started in the period. Orders and net sales: the bills each person settled while on shift (net of refunds made then). Handed over: open tables passed on when the shift ended." : "Shifts need Clock in / out (Settings › Staff), which is off; these are any recorded before."}
      >
        {shiftRows.length ? (
          <SortableTable
            columns={SHIFT_COLUMNS}
            rows={shiftRows}
            totals={{ name: `${shifts.totals.shifts} ${shifts.totals.shifts === 1 ? "shift" : "shifts"}`, hours: formatHours(shifts.totals.seconds), orders: String(shifts.totals.orders), net: formatNaira(shifts.totals.net), handed: shifts.totals.handedOver ? `${shifts.totals.handedOver} handed over` : "" }}
            defaultSort="in"
            textColumns={["name", "role", "handed"]}
            data="shift"
            param="s"
          />
        ) : (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>No shifts in this period.</span>
        )}
      </Section>

      <Section
        title="Cash-up"
        data="tills"
        note={`Each till's session opened in the period. Expected: float + cash sales + cash tips − cash refunds; variance: counted − expected. Red: out by more than ${formatNaira(limit)} (the limit is in Restaurant › Touch POS). Reprint Z sends that session's Z-report to its till's receipt printer.`}
      >
        {tillRows.length ? (
          <SortableTable
            columns={TILL_COLUMNS}
            rows={tillRows}
            totals={{ device: `${tills.totals.tills} ${tills.totals.tills === 1 ? "session" : "sessions"}`, cashSales: formatNaira(tills.totals.cashSales), cashRefunds: formatNaira(tills.totals.cashRefunds), drawer: String(tills.totals.drawerOpens), variance: tills.totals.overLimit ? `${tills.totals.overLimit} over the limit` : varianceText(tills.totals.variance, formatNaira) }}
            defaultSort="opened"
            textColumns={["device"]}
            data="till"
            param="c"
            trailing={{ label: "Z-report", width: "110px" }}
          />
        ) : (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>No till was opened in this period.</span>
        )}
      </Section>
    </div>
  );
}
