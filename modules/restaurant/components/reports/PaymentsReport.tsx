import type { ReactNode } from "react";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { orderRef } from "../../lib/format";
import { methodLines, refundTotals, tipLines } from "../../lib/reportPayments";
import { formatAppDateTime } from "../../lib/time";
import { REFUND_LIST_LIMIT, type PaymentsData } from "../../server/queries/reports/payments";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";

export const METHOD_COLUMNS: SortableColumn[] = [
  { key: "method", label: "Method", width: "minmax(150px,1fr)" },
  { key: "count", label: "Payments", width: "110px", align: "right" },
  { key: "amount", label: "Amount", width: "150px", align: "right" },
  { key: "share", label: "% of total", width: "110px", align: "right" },
];
export const TIP_WAITER_COLUMNS: SortableColumn[] = [
  { key: "name", label: "Waiter", width: "minmax(150px,1fr)" },
  { key: "count", label: "Tips", width: "80px", align: "right" },
  { key: "amount", label: "Amount", width: "130px", align: "right" },
];
export const TIP_METHOD_COLUMNS: SortableColumn[] = [
  { key: "method", label: "Method", width: "minmax(130px,1fr)" },
  { key: "count", label: "Tips", width: "80px", align: "right" },
  { key: "amount", label: "Amount", width: "130px", align: "right" },
];
export const REFUND_COLUMNS: SortableColumn[] = [
  { key: "at", label: "Date", width: "150px" },
  { key: "reference", label: "Refund", width: "130px" },
  { key: "sale", label: "Sale", width: "130px" },
  { key: "order", label: "Order", width: "100px" },
  { key: "amount", label: "Amount", width: "120px", align: "right" },
  { key: "methods", label: "Method", width: "minmax(120px,1fr)" },
  { key: "by", label: "Refunded by", width: "minmax(130px,1fr)" },
  { key: "toStock", label: "Back to stock", width: "110px" },
];

function Section({ title, note, children, data }: { title: string; note?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section aria-label={title} data-payments-section={data} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {children}
      {note && <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{note}</span>}
    </section>
  );
}

// Restaurant Reports › Payments & tips (Step 6).
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function paymentsTables({ data, knownWaiters }: { data: PaymentsData; knownWaiters: ReadonlySet<string> }) {
  const methods = methodLines(data.methods);
  const methodRows: SortableRow[] = methods.lines.map((l) => ({
    id: l.method,
    cells: { method: PAYMENT_TYPE_LABELS[l.method], count: String(l.count), amount: formatNaira(l.amount), share: l.share === null ? "—" : `${l.share.toFixed(1)}%` },
    sort: { method: PAYMENT_TYPE_LABELS[l.method].toLowerCase(), count: l.count, amount: Number(l.amount), share: l.share },
  }));

  const tips = tipLines(data.tipsByWaiter, data.names);
  const tipRows: SortableRow[] = tips.lines.map((l) => ({
    id: l.userId,
    cells: { name: l.name, count: String(l.count), amount: formatNaira(l.amount) },
    sort: { name: l.name.toLowerCase(), count: l.count, amount: Number(l.amount) },
    filter: knownWaiters.has(l.userId) ? { param: "waiter", value: l.userId, title: `Show only ${l.name}'s orders, on every tab` } : null,
  }));
  const tipMethods = methodLines(data.tipsByMethod);
  const tipMethodRows: SortableRow[] = tipMethods.lines
    .filter((l) => l.count > 0)
    .map((l) => ({ id: l.method, cells: { method: PAYMENT_TYPE_LABELS[l.method], count: String(l.count), amount: formatNaira(l.amount) }, sort: { method: PAYMENT_TYPE_LABELS[l.method].toLowerCase(), count: l.count, amount: Number(l.amount) } }));

  const refunds = refundTotals(data.refunds);
  const refundRows: SortableRow[] = data.refunds.map((r) => ({
    id: r.id,
    cells: {
      at: formatAppDateTime(r.at),
      reference: r.reference,
      sale: r.sale,
      order: orderRef(r.orderNumber),
      amount: formatNaira(String(r.amount)),
      methods: r.methods.length ? r.methods.map((m) => PAYMENT_TYPE_LABELS[m]).join(", ") : "—",
      by: r.by ?? "—",
      toStock: r.toStock ? "Yes" : "No",
    },
    sort: { at: r.at.getTime(), reference: r.reference, sale: r.sale, order: r.orderNumber, amount: Number(r.amount), methods: r.methods.join(","), by: (r.by ?? "").toLowerCase(), toStock: r.toStock ? 1 : 0 },
  }));
  return { methods, methodRows, tips, tipRows, tipMethods, tipMethodRows, refunds, refundRows };
}

export default function PaymentsReport({ data, knownWaiters }: { data: PaymentsData; knownWaiters: ReadonlySet<string> }) {
  const { methods, methodRows, tips, tipRows, tipMethods, tipMethodRows, refunds, refundRows } = paymentsTables({ data, knownWaiters });

  return (
    <div data-payments-report style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Section title="By payment method" data="methods" note="The settled bills' payments: a split bill counts each part's method. Exactly what was due — change and tips aren't in it.">
        <SortableTable columns={METHOD_COLUMNS} rows={methodRows} totals={{ method: "Total", count: String(methods.totals.count), amount: formatNaira(methods.totals.amount), share: methods.totals.count ? "100.0%" : "—" }} defaultSort="amount" textColumns={["method"]} data="method" param="m" />
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 18 }}>
        <Section title="Tips by waiter" data="tips-waiter" note="Tips are the waiter's, never part of net sales.">
          {tipRows.length ? (
            <SortableTable columns={TIP_WAITER_COLUMNS} rows={tipRows} totals={{ name: "Total", count: String(tips.totals.count), amount: formatNaira(tips.totals.amount) }} defaultSort="amount" textColumns={["name"]} data="tip" param="t" />
          ) : (
            <span style={{ fontSize: 13, color: COLORS.slateMid }}>No tips in this period.</span>
          )}
        </Section>
        <Section title="Tips by method" data="tips-method">
          {tipMethodRows.length ? (
            <SortableTable columns={TIP_METHOD_COLUMNS} rows={tipMethodRows} totals={{ method: "Total", count: String(tipMethods.totals.count), amount: formatNaira(tipMethods.totals.amount) }} defaultSort="amount" textColumns={["method"]} data="tipmethod" param="tm" />
          ) : (
            <span style={{ fontSize: 13, color: COLORS.slateMid }}>No tips in this period.</span>
          )}
        </Section>
      </div>

      <Section
        title="Refunds in the period"
        data="refunds"
        note={
          <>
            Each refund made in the period, whichever day its bill was settled; net sales take them off in this period.
            {data.refundsCut ? ` Showing the latest ${REFUND_LIST_LIMIT}; narrow the period to see the rest.` : ""}
          </>
        }
      >
        {refundRows.length ? (
          <SortableTable
            columns={REFUND_COLUMNS}
            rows={refundRows}
            totals={{ at: `${refunds.count} ${refunds.count === 1 ? "refund" : "refunds"}`, amount: formatNaira(refunds.amount), toStock: `${refunds.toStock} of ${refunds.count}` }}
            defaultSort="at"
            textColumns={["reference", "sale", "methods", "by"]}
            data="refund"
            param="r"
          />
        ) : (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>No refunds in this period.</span>
        )}
      </Section>
    </div>
  );
}
