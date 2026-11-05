"use client";

import { Suspense, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import Pagination from "@/components/ui/Pagination";
import SearchInput from "@/components/ui/SearchInput";
import ReportTable, { type ReportColumn } from "@/components/reports/ReportTable";
import { R } from "../../lib/theme";
import type { TableRow } from "../../server/queries/tables";
import { deleteTable } from "../../server/actions/tables";
import StatusPill from "../StatusPill";
import TableModal, { type AreaOption, type EditableTable } from "./TableModal";

const OPEN_ORDER = "Has an open order";

function HeaderButton({
  children,
  onClick,
  href,
  primary,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const hover = useToggleState();
  const style = {
    height: 36,
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    background: primary ? (disabled ? COLORS.slateLight : hover.value ? COLORS.tealDark : COLORS.teal) : hover.value ? COLORS.bgApp : "#fff",
    border: primary ? "none" : `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: primary ? "#fff" : COLORS.slate,
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap",
  } as const;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener" onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
      {children}
    </button>
  );
}

function TextAction({ children, onClick, color, title }: { children: ReactNode; onClick: () => void; color: string; title: string }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        padding: 0,
        border: "none",
        background: "none",
        fontSize: 12.5,
        fontWeight: 600,
        color,
        cursor: "pointer",
        textDecoration: hover.value ? "underline" : "none",
      }}
    >
      {children}
    </button>
  );
}

// "All areas" / one area — writes ?area= and goes back to page 1.
function AreaFilter({ areas, value }: { areas: AreaOption[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focus = useToggleState();

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("area", next);
    else params.delete("area");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{ position: "relative" }}>
      <select
        aria-label="Area"
        value={value}
        onChange={(event) => change(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          appearance: "none",
          height: 34,
          border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 7,
          padding: "0 28px 0 8px",
          fontSize: 13,
          background: "#fff",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">All areas</option>
        {areas.map((area) => (
          <option key={area.id} value={area.id}>
            {area.name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 9, top: 11, pointerEvents: "none" }} />
    </div>
  );
}

// RingzPOS Tables design, main list: Table, Area, Seats, Status (from
// tableStatus, on the server), QR menu and actions. Filter by area and
// search by name live in the URL (?area, ?q), as does the page.
export default function TablesPanel({
  rows,
  areas,
  areaId,
  filtered,
  page,
  perPage,
  total,
  totalPages,
}: {
  rows: TableRow[];
  areas: AreaOption[];
  areaId: string;
  // A search or area filter is on (for the empty message).
  filtered: boolean;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}) {
  const [editing, setEditing] = useState<EditableTable | "new" | null>(null);
  const [deleting, setDeleting] = useState<TableRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function askDelete(row: TableRow) {
    if (row.hasOpenOrder) toast.error(`${row.name} has an open order, so it can't be deleted. Close the order first.`);
    else setDeleting(row);
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteTable(deleting.id);
      setDeleting(null);
      if (result.ok) {
        toast.success(`Table ${deleting.name} deleted.`);
      } else {
        toast.error(result.error);
      }
    });
  }

  const columns: ReportColumn<TableRow>[] = [
    { label: "Table", width: "80px", render: (row) => <span style={{ fontFamily: FONTS.display, fontWeight: 600, fontSize: 15 }}>{row.name}</span> },
    { label: "Area", width: "minmax(100px,1fr)", render: (row) => <span style={{ color: COLORS.slate }}>{row.areaName}</span> },
    { label: "Seats", width: "70px", render: (row) => <span style={{ fontFamily: FONTS.mono }}>{row.seats}</span> },
    { label: "Status", width: "110px", render: (row) => <StatusPill status={row.status} /> },
    {
      label: "QR menu",
      width: "120px",
      render: (row) => (
        <a href={`/restaurant/tables/${row.id}/qr`} download style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.teal, textDecoration: "none" }}>
          Download QR
        </a>
      ),
    },
    {
      label: "",
      width: "90px",
      render: (row) => (
        <span style={{ display: "flex", gap: 10 }} data-table={row.name}>
          <TextAction
            title="Edit table"
            color={COLORS.slate}
            onClick={() => setEditing({ id: row.id, name: row.name, seats: row.seats, areaId: row.areaId })}
          >
            Edit
          </TextAction>
          <TextAction title={row.hasOpenOrder ? OPEN_ORDER : "Delete table"} color={row.hasOpenOrder ? R.disabled : R.danger} onClick={() => askDelete(row)}>
            Delete
          </TextAction>
        </span>
      ),
    },
  ];

  const printHref = `/restaurant/qr-codes${areaId ? `?area=${encodeURIComponent(areaId)}` : ""}`;
  const emptyMessage =
    areas.length === 0 ? "Add a dining area first, then its tables." : filtered ? "No tables match." : "No tables yet.";

  return (
    <section aria-label="Tables" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Tables</h2>
        <Suspense fallback={null}>
          <AreaFilter areas={areas} value={areaId} />
          <SearchInput placeholder="Search tables" width={170} height={34} />
        </Suspense>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <HeaderButton href={printHref}>Print all QR codes</HeaderButton>
          <HeaderButton
            primary
            disabled={areas.length === 0}
            title={areas.length === 0 ? "Add a dining area first." : undefined}
            onClick={() => setEditing("new")}
          >
            + Add table
          </HeaderButton>
        </span>
      </div>

      <ReportTable columns={columns} rows={rows} rowKey={(row) => row.id} minWidth={600} emptyMessage={emptyMessage} rowHeight={46} flush />

      <Suspense fallback={null}>
        <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
      </Suspense>
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 12.5, color: COLORS.slateMid }}>
        Tables with an open order can&apos;t be deleted.
      </div>

      {editing && (
        <TableModal
          table={editing === "new" ? null : editing}
          areas={areas}
          defaultAreaId={areaId || undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete table"
          message={`Delete table ${deleting.name} (${deleting.areaName})? Its QR code stops working and it leaves the floor plan.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </section>
  );
}
