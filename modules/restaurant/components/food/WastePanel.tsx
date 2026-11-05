"use client";

import { Suspense, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ClipboardList, Flag, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import Pagination from "@/components/ui/Pagination";
import SearchInput from "@/components/ui/SearchInput";
import ReportDatePicker from "@/components/reports/ReportDatePicker";
import ReportTable, { type ReportColumn } from "@/components/reports/ReportTable";
import { todayInAppZone } from "@/lib/dateRanges";
import { formatNaira } from "@/lib/format";
import { R } from "../../lib/theme";
import { dayLabel, formatAppTime } from "../../lib/time";
import { WASTE_REASON_LABEL, WASTE_STATUS_LABEL } from "../../lib/waste";
import type { Approver } from "../../server/queries/approvers";
import type { WasteItemOption, WasteRow, WasteSummary } from "../../server/queries/waste";
import KpiTile from "../dashboard/KpiTile";
import LogWasteModal from "./LogWasteModal";
import VoidWasteModal from "./VoidWasteModal";
import WasteDrawer from "./WasteDrawer";
import { WasteReasonPill, WasteStatusPill } from "./WastePills";

// Food › Waste: the period's waste (default today) with the summary strip,
// filters in the URL (?from&to, ?reason, ?user, ?status, ?q, the page), Log
// waste (Log Waste), View, and Void (Approve Waste).

type Option = { value: string; label: string };

const REASON_OPTIONS: Option[] = Object.entries(WASTE_REASON_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS: Option[] = Object.entries(WASTE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

// A filter written to the URL (empty: every value), back to page 1.
function UrlSelect({ param, label, all, options, value }: { param: string; label: string; all: string; options: Option[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(param, next);
    else params.delete(param);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div style={{ position: "relative" }}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => change(event.target.value)}
        style={{ appearance: "none", height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 30px 0 10px", fontSize: 13.5, background: "#fff", cursor: "pointer", outline: "none", maxWidth: 200 }}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 10, top: 14, pointerEvents: "none" }} />
    </div>
  );
}

function LogButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ height: 38, padding: "0 14px", background: hover.value ? COLORS.tealDark : COLORS.teal, border: "none", borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
    >
      + Log waste
    </button>
  );
}

const textButton = { border: "none", background: "none", padding: "4px 6px", fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;

export default function WastePanel({
  tabs,
  rows,
  summary,
  period,
  today,
  reason,
  userId,
  status,
  users,
  filtered,
  items,
  approvers,
  canLog,
  canVoid,
  page,
  perPage,
  total,
  totalPages,
}: {
  // The Food tabs (a server component).
  tabs: ReactNode;
  rows: WasteRow[];
  summary: WasteSummary;
  // "Today", "Mon 3 Nov – Today".
  period: string;
  // The app's today (YYYY-MM-DD), for the date column.
  today: string;
  reason: string;
  userId: string;
  status: string;
  users: { id: string; name: string }[];
  // A reason, user, status or search filter is on.
  filtered: boolean;
  items: WasteItemOption[];
  approvers: Approver[];
  canLog: boolean;
  canVoid: boolean;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}) {
  const [logging, setLogging] = useState(false);
  // Ids, so the drawer shows the row as refreshed after a void.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const viewing = rows.find((r) => r.id === viewingId) ?? null;
  const voiding = rows.find((r) => r.id === voidingId) ?? null;

  const columns: ReportColumn<WasteRow>[] = [
    {
      label: "Date/time",
      width: "90px",
      render: (row) => {
        const at = new Date(row.createdAt);
        return (
          <span data-waste-row={row.id} style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontWeight: 600, fontFamily: FONTS.mono, fontSize: 13 }}>{formatAppTime(at)}</span>
            <span style={{ fontSize: 11.5, color: COLORS.slateMid }}>{dayLabel(todayInAppZone(at), today)}</span>
          </span>
        );
      },
    },
    {
      label: "Item",
      width: "minmax(160px,1.5fr)",
      render: (row) => (
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 }}>
          <span data-item style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.item.name}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateLight }}>{row.order ? `${row.item.code} · ${row.order.ref}` : row.item.code}</span>
        </span>
      ),
    },
    {
      label: "Qty",
      width: "72px",
      render: (row) => (
        <span data-qty style={{ fontFamily: FONTS.mono, fontSize: 13 }}>
          {row.qty} {row.unit}
        </span>
      ),
    },
    { label: "Reason", width: "130px", render: (row) => <WasteReasonPill reason={row.reason} /> },
    {
      label: "Cost",
      width: "90px",
      align: "right",
      render: (row) => (
        <span data-cost style={{ fontWeight: 600, fontSize: 13.5, textDecoration: row.status === "VOID" ? "line-through" : "none", color: row.status === "VOID" ? COLORS.slateMid : COLORS.ink }}>
          {formatNaira(row.cost)}
        </span>
      ),
    },
    { label: "Logged by", width: "minmax(100px,1fr)", render: (row) => <span title={row.loggedBy} style={{ fontSize: 13.5 }}>{row.loggedBy}</span> },
    { label: "Approved by", width: "minmax(100px,1fr)", render: (row) => <span title={row.approvedBy ?? undefined} style={{ fontSize: 13.5, color: row.approvedBy ? COLORS.ink : COLORS.slateLight }}>{row.approvedBy ?? "—"}</span> },
    { label: "Status", width: "76px", render: (row) => <WasteStatusPill status={row.status} /> },
    {
      label: "Actions",
      width: "96px",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 2 }}>
          <button type="button" aria-label={`View ${row.item.name}`} onClick={() => setViewingId(row.id)} style={{ ...textButton, color: COLORS.tealDark }}>
            View
          </button>
          {canVoid && row.status === "ACTIVE" && (
            <button type="button" aria-label={`Void ${row.item.name}`} onClick={() => setVoidingId(row.id)} style={{ ...textButton, color: R.danger }}>
              Void
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>Food</h1>
        {tabs}
        {canLog && (
          <span style={{ marginLeft: "auto" }}>
            <LogButton onClick={() => setLogging(true)} />
          </span>
        )}
      </div>

      <div aria-label="Waste summary" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
        <KpiTile label={`Waste cost · ${period}`} tone="rose" icon={Trash2} value={formatNaira(summary.total)} note="Voided entries left out" />
        <KpiTile label="Entries" tone="amber" icon={ClipboardList} value={String(summary.count)} note={summary.count === 1 ? "1 waste entry" : `${summary.count} waste entries`} />
        <KpiTile
          label="Top reason"
          tone="orange"
          icon={Flag}
          value={summary.topReason ? WASTE_REASON_LABEL[summary.topReason] : "—"}
          note={summary.topReason && summary.topReasonCost ? `${formatNaira(summary.topReasonCost)} of the period's waste` : "No waste this period"}
        />
      </div>

      <section aria-label="Waste entries" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: 16 }}>
          <Suspense fallback={null}>
            <ReportDatePicker />
            <UrlSelect param="reason" label="Reason" all="All reasons" options={REASON_OPTIONS} value={reason} />
            <UrlSelect param="user" label="Logged by" all="Everyone" options={users.map((u) => ({ value: u.id, label: u.name }))} value={userId} />
            <UrlSelect param="status" label="Status" all="Any status" options={STATUS_OPTIONS} value={status} />
            <span style={{ marginLeft: "auto" }}>
              <SearchInput placeholder="Search by item" width={240} height={40} />
            </span>
          </Suspense>
        </div>
        <ReportTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          // Fits the card at 1440px with the app sidebar open (no sideways scroll).
          minWidth={1090}
          emptyMessage={filtered ? "No waste logged for this period matches these filters." : "No waste logged for this period."}
        />
        <Suspense fallback={null}>
          <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
        </Suspense>
      </section>

      {logging && <LogWasteModal items={items} approvers={approvers} onClose={() => setLogging(false)} />}
      {viewing && !voiding && <WasteDrawer entry={viewing} canVoid={canVoid} onVoid={() => setVoidingId(viewing.id)} onClose={() => setViewingId(null)} />}
      {voiding && <VoidWasteModal entry={voiding} onClose={() => setVoidingId(null)} />}
    </div>
  );
}
