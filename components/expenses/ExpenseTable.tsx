"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Pencil, Receipt, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";
import { formatNaira } from "@/lib/format";

// RingzPOS Expenses design.
const GRID = "120px minmax(180px,1fr) 140px minmax(160px,1fr) 160px 150px 100px";

export type ExpenseRow = {
  id: string;
  reference: string;
  title: string;
  warehouseName: string;
  categoryName: string;
  // Decimal as a string.
  amount: string;
  // Pre-formatted on the server.
  createdDate: string;
  createdTime: string;
};

export type ExpenseDeleteResult = { ok: boolean; error?: string };

const header = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

function ExpenseTableRow({
  row,
  onDelete,
  canDelete,
}: {
  row: ExpenseRow;
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
        height: 64,
        borderBottom: `1px solid ${COLORS.bgApp}`,
        whiteSpace: "nowrap",
        transition: "background .12s",
        background: hover.value ? COLORS.bgApp : "transparent",
      }}
    >
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 12,
          fontWeight: 500,
          background: "#fce8e6",
          border: "1px solid #f4cfcc",
          color: "#93201a",
          padding: "4px 9px",
          borderRadius: 6,
          justifySelf: "start",
        }}
      >
        {row.reference}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</span>
      <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.warehouseName}
      </span>
      <span style={{ fontSize: 14, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.categoryName}
      </span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
        {formatNaira(row.amount)}
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{row.createdDate}</span>
        <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{row.createdTime}</span>
      </span>
      <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
        <IconActionButton
          icon={<Pencil size={15} strokeWidth={1.8} />}
          title="Edit expense"
          href={`/expenses/${row.id}/edit`}
        />
        <IconActionButton
          icon={<Trash2 size={15} strokeWidth={1.8} />}
          title="Delete expense"
          tone="danger"
          onClick={onDelete}
          disabled={!canDelete}
        />
      </span>
    </div>
  );
}

// Expenses table body: server data comes in as props; the action buttons and
// the delete confirmation are client state. Delete is disabled until a
// deleteAction is passed.
export default function ExpenseTable({
  rows,
  deleteAction,
}: {
  rows: ExpenseRow[];
  deleteAction?: (id: string) => Promise<ExpenseDeleteResult>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<ExpenseRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmDelete() {
    if (!deleteAction || !confirming) return;
    const target = confirming;
    startTransition(async () => {
      // The server re-checks the permission and re-reads the expense.
      const result = await deleteAction(target.id);
      setConfirming(null);
      if (result.ok) {
        toast.success(`Expense ${target.reference} deleted.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={Receipt} message="No expenses found." />;
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
            <span style={header}>Reference</span>
            <span style={header}>Expense title</span>
            <span style={header}>Warehouse</span>
            <span style={header}>Expense category</span>
            <span style={{ ...header, textAlign: "right" }}>Amount</span>
            <span style={header}>Created on</span>
            <span style={{ ...header, textAlign: "right" }}>Action</span>
          </div>

          {rows.map((row) => (
            <ExpenseTableRow
              key={row.id}
              row={row}
              onDelete={() => setConfirming(row)}
              canDelete={!!deleteAction}
            />
          ))}
        </div>
      </div>

      {confirming && (
        <ConfirmDeleteModal
          title="Delete expense"
          message={`Are you sure you want to delete "${confirming.reference}" (${confirming.title}, ${formatNaira(confirming.amount)})? This can't be undone from here.`}
          pending={isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
