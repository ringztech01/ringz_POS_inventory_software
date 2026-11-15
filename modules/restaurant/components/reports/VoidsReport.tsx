import Link from "next/link";
import type { ReactNode } from "react";
import { BadgePercent, CircleSlash, ShieldCheck, TriangleAlert } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { orderRef } from "../../lib/format";
import { auditHref, discountAsked, discountShare, overLimit, voidReason, voidsTotals } from "../../lib/reportVoids";
import { todayInAppZone } from "@/lib/dateRanges";
import { formatAppDateTime } from "../../lib/time";
import type { ReportWindow } from "../../server/queries/reports/filters";
import { LIST_LIMIT, type VoidsData } from "../../server/queries/reports/voids";
import KpiTile from "../dashboard/KpiTile";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";

const col = (key: string, label: string, width: string, align?: "right"): SortableColumn => ({ key, label, width, align });
export const VOID_COLUMNS = [
  col("at", "Date", "140px"),
  col("order", "Order", "100px"),
  col("table", "Table", "90px"),
  col("item", "Item", "minmax(140px,1fr)"),
  col("quantity", "Qty", "60px", "right"),
  col("value", "Value", "110px", "right"),
  col("waiter", "Waiter", "minmax(110px,1fr)"),
  col("voidedBy", "Voided by", "minmax(110px,1fr)"),
  col("reason", "Reason", "minmax(130px,1fr)"),
  col("approvedBy", "Approved by", "minmax(110px,1fr)"),
];
export const DISCOUNT_COLUMNS = [
  col("order", "Order", "100px"),
  col("at", "Settled", "140px"),
  col("type", "Type", "90px"),
  col("value", "Value", "90px", "right"),
  col("amount", "Amount", "110px", "right"),
  col("share", "% of bill", "90px", "right"),
  col("reason", "Reason", "minmax(140px,1fr)"),
  col("appliedBy", "Applied by", "minmax(110px,1fr)"),
  col("approvedBy", "Approved by", "minmax(110px,1fr)"),
];

function Section({ title, link, note, children, data }: { title: string; link: { href: string; label: string } | null; note?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section aria-label={title} data-voids-section={data} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
        {link && (
          <Link href={link.href} data-audit-link={data} style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.tealDark, textDecoration: "none" }}>
            {link.label} →
          </Link>
        )}
      </div>
      {children}
      {note && <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{note}</span>}
    </section>
  );
}

// Restaurant Reports › Voids & discounts (Step 8): the totals, then each
// void and each discount — those past the approval limits highlighted —
// with links to the matching Audit log entries (Part 6f).
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function voidsTables({ data, window, canAudit }: { data: VoidsData; window: ReportWindow; canAudit: boolean }) {
  const range = { from: window.from, to: window.to };
  const limit = data.limitPercent.toString();
  const discountRows: SortableRow[] = data.discounts.map((d) => {
    const share = discountShare(d.amount, d.items);
    const over = overLimit(share, data.limitPercent);
    return {
      id: d.orderId,
      cells: {
        order: orderRef(d.orderNumber),
        at: formatAppDateTime(d.at),
        type: d.type === "PERCENT" ? "Percent" : "Amount",
        value: discountAsked(d.type, d.value),
        amount: formatNaira(d.amount.toString()),
        share: share === null ? "—" : `${share.toFixed(1)}%`,
        reason: d.reason ?? "—",
        appliedBy: d.appliedBy ?? "—",
        approvedBy: d.approvedBy ?? (over ? "Not recorded" : "—"),
      },
      sort: { order: d.orderNumber, at: d.at.getTime(), type: d.type, value: Number(d.value), amount: Number(d.amount), share, reason: (d.reason ?? "").toLowerCase(), appliedBy: (d.appliedBy ?? "").toLowerCase(), approvedBy: (d.approvedBy ?? "").toLowerCase() },
      flag: over ? `Over the ${limit}% discount limit` : null,
    };
  });
  const overCount = discountRows.filter((r) => r.flag).length;
  const totals = voidsTotals({ voids: data.totals.voids, discounts: data.totals.discounts, overLimit: overCount });

  const voidRows: SortableRow[] = data.voids.map((v) => ({
    id: v.id,
    cells: {
      at: formatAppDateTime(v.at),
      order: orderRef(v.orderNumber),
      table: v.table ?? "—",
      item: v.item,
      quantity: String(v.quantity),
      value: formatNaira(v.value.toString()),
      waiter: v.waiter ?? "—",
      voidedBy: v.voidedBy ?? "—",
      reason: voidReason(v.reason) ?? "—",
      approvedBy: v.approvedBy ?? "—",
    },
    sort: { at: v.at.getTime(), order: v.orderNumber, table: (v.table ?? "").toLowerCase(), item: v.item.toLowerCase(), quantity: v.quantity, value: Number(v.value), waiter: (v.waiter ?? "").toLowerCase(), voidedBy: (v.voidedBy ?? "").toLowerCase(), reason: (voidReason(v.reason) ?? "").toLowerCase(), approvedBy: (v.approvedBy ?? "").toLowerCase() },
    flag: v.approvedBy ? `Needed a manager's PIN: approved by ${v.approvedBy}` : null,
    // One void's Audit log: that day, that person.
    link: canAudit ? { href: auditHref({ from: todayInAppZone(v.at), to: todayInAppZone(v.at) }, "VOID", v.voidedById), title: "Open this day's voids by this person in the Audit log" } : null,
  }));
  return { range, limit, discountRows, overCount, totals, voidRows };
}

export default function VoidsReport({ data, window, canAudit }: { data: VoidsData; window: ReportWindow; canAudit: boolean }) {
  const { range, limit, discountRows, totals, voidRows } = voidsTables({ data, window, canAudit });

  return (
    <div data-voids-report style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
        <KpiTile label="Voids" tone="rose" icon={CircleSlash} value={String(totals.voids)} note={`${formatNaira(totals.voidValue)} voided`} />
        <KpiTile label="Discounts" tone="violet" icon={BadgePercent} value={String(totals.discounts)} note={`${formatNaira(totals.discountAmount)} off`} />
        <KpiTile label="Manager approved" tone="blue" icon={ShieldCheck} value={String(totals.voidsApproved + totals.discountsApproved)} note={`${totals.voidsApproved} ${totals.voidsApproved === 1 ? "void" : "voids"}, ${totals.discountsApproved} ${totals.discountsApproved === 1 ? "discount" : "discounts"}`} />
        <KpiTile label="Over the discount limit" tone="amber" icon={TriangleAlert} value={String(totals.overLimit)} note={`Over ${limit}% of the bill`} />
      </div>

      <Section title="Voids" data="voids" link={canAudit ? { href: auditHref(range, "VOID"), label: "See them in the Audit log" } : null} note={<>Sent lines voided in the period. Highlighted: a void that needed a manager&apos;s PIN. Voids have no money limit; a manager&apos;s PIN is needed by anyone without Approve Voids &amp; Refunds.{data.cut.voids ? ` Showing the latest ${LIST_LIMIT}; the totals above count them all.` : ""}</>}>
        {voidRows.length ? <SortableTable columns={VOID_COLUMNS} rows={voidRows} totals={{ at: `${totals.voids} ${totals.voids === 1 ? "void" : "voids"}`, value: formatNaira(totals.voidValue) }} defaultSort="at" textColumns={["table", "item", "waiter", "voidedBy", "reason", "approvedBy"]} data="void" param="v" /> : <span style={{ fontSize: 13, color: COLORS.slateMid }}>No voids in this period.</span>}
      </Section>

      <Section title="Discounts" data="discounts" link={canAudit ? { href: auditHref(range, "OVERRIDE"), label: "See the approvals in the Audit log" } : null} note={<>The period&apos;s settled bills with a discount. Highlighted: over the {limit}% limit (its share of the bill&apos;s items), which needs a manager&apos;s PIN.{data.cut.discounts ? ` Showing the latest ${LIST_LIMIT}; the totals above count them all.` : ""}</>}>
        {discountRows.length ? <SortableTable columns={DISCOUNT_COLUMNS} rows={discountRows} totals={{ order: `${totals.discounts} ${totals.discounts === 1 ? "bill" : "bills"}`, amount: formatNaira(totals.discountAmount) }} defaultSort="at" textColumns={["type", "reason", "appliedBy", "approvedBy"]} data="discount" param="d" /> : <span style={{ fontSize: 13, color: COLORS.slateMid }}>No discounts in this period.</span>}
      </Section>
    </div>
  );
}
