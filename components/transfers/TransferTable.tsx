"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeftRight, Eye, Pencil, Trash2 } from "lucide-react";
import type { TransferStatus } from "@prisma/client";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";
import { PurchaseStatusPill, TRANSFER_STATUS_COLORS } from "@/components/purchases/purchase-display";
import { formatNaira } from "@/lib/format";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";

// RingzPOS Transfers design.
const GRID = "44px 130px minmax(160px,1fr) minmax(160px,1fr) 90px 140px 130px 150px 120px";

export type TransferRow = {
  id: string;
  reference: string;
  fromName: string;
  toName: string;
  items: number;
  // Decimal as a string.
  grandTotal: string;
  status: TransferStatus;
  // Pre-formatted on the server.
  createdDate: string;
  createdTime: string;
};

const header = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

const checkbox = { width: 16, height: 16, accentColor: COLORS.teal, cursor: "pointer", margin: 0 } as const;

function TransferTableRow({
  row,
  selected,
  onToggle,
  onDelete,
  canDelete,
}: {
  row: TransferRow;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const hover = useToggleState();

  return (
    <div
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        columnGap: 16,
        alignItems: "center",
        padding: "0 20px",
        height: 60,
        borderBottom: `1px solid ${COLORS.bgApp}`,
        whiteSpace: "nowrap",
        transition: "background .12s",
        background: hover.value ? COLORS.bgApp : "transparent",
      }}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.reference}`} style={checkbox} />
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 12,
          fontWeight: 500,
          background: COLORS.bgApp,
          border: `1px solid ${COLORS.borderStrong}`,
          color: COLORS.text,
          padding: "4px 9px",
          borderRadius: 6,
          justifySelf: "start",
        }}
      >
        {row.reference}
      </span>
      <span style={{ fontSize: 14, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis" }}>{row.fromName}</span>
      <span style={{ fontSize: 14, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis" }}>{row.toName}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>{row.items}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
        {formatNaira(row.grandTotal)}
      </span>
      <PurchaseStatusPill status={row.status} palette={TRANSFER_STATUS_COLORS} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{row.createdDate}</span>
        <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{row.createdTime}</span>
      </span>
      <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
        <IconActionButton
          icon={<Eye size={15} strokeWidth={1.8} />}
          title="View transfer"
          href={`/transfers/${row.id}`}
          baseColor={COLORS.teal}
        />
        <IconActionButton
          icon={<Pencil size={15} strokeWidth={1.8} />}
          title="Edit transfer"
          href={`/transfers/${row.id}/edit`}
        />
        <IconActionButton
          icon={<Trash2 size={15} strokeWidth={1.8} />}
          title="Delete transfer"
          tone="danger"
          onClick={onDelete}
          disabled={!canDelete}
        />
      </span>
    </div>
  );
}

// Transfers table body. Server data comes in as props; selection, the action
// buttons and the delete confirmation are client state. The delete button is
// disabled until a deleteAction is passed.
export default function TransferTable({
  rows,
  deleteAction,
}: {
  rows: TransferRow[];
  deleteAction?: (id: string) => Promise<PurchaseActionState>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<TransferRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Only ids still on this page count (rows change on search/paging).
  const selectedHere = rows.filter((row) => selected.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedHere === rows.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function handleConfirmDelete() {
    if (!deleteAction || !confirming) return;
    const target = confirming;
    startTransition(async () => {
      // The server re-checks the permission and re-reads the transfer.
      const result = await deleteAction(target.id);
      setConfirming(null);
      if (result.ok) {
        toast.success(`Transfer ${target.reference} deleted.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={ArrowLeftRight} message="No transfers found." />;
  }

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 1440 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              columnGap: 16,
              alignItems: "center",
              padding: "0 20px",
              height: 44,
              background: COLORS.bgInput,
              borderBottom: `1px solid ${COLORS.border}`,
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedHere > 0 && !allSelected;
              }}
              onChange={toggleAll}
              aria-label="Select all transfers"
              style={checkbox}
            />
            <span style={header}>Reference</span>
            <span style={header}>From warehouse</span>
            <span style={header}>To warehouse</span>
            <span style={{ ...header, textAlign: "right" }}>Items</span>
            <span style={{ ...header, textAlign: "right" }}>Grand total</span>
            <span style={header}>Status</span>
            <span style={header}>Created on</span>
            <span style={{ ...header, textAlign: "right" }}>Action</span>
          </div>

          {rows.map((row) => (
            <TransferTableRow
              key={row.id}
              row={row}
              selected={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
              onDelete={() => setConfirming(row)}
              canDelete={!!deleteAction}
            />
          ))}
        </div>
      </div>

      {confirming && (
        <ConfirmDeleteModal
          title="Delete transfer"
          message={
            confirming.status === "COMPLETED"
              ? `Are you sure you want to delete "${confirming.reference}"? This moves its stock back from ${confirming.toName} to ${confirming.fromName}.`
              : `Are you sure you want to delete "${confirming.reference}"? It hasn't moved any stock, so stock levels won't change.`
          }
          pending={isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
