"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";

// RingzPOS Roles design.
const GRID = "minmax(240px,1fr) 220px 110px";

export type RoleRow = {
  id: string;
  name: string;
  isSystem: boolean;
  // Pre-formatted on the server.
  createdDate: string;
};

export type RoleDeleteResult = { ok: boolean; error?: string };

const header = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

function RoleTableRow({ row, onDelete, canDelete }: { row: RoleRow; onDelete: () => void; canDelete: boolean }) {
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
        transition: "background .12s",
        background: hover.value ? COLORS.bgApp : "transparent",
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: COLORS.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.name}
      </span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>{row.createdDate}</span>
      <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
        <IconActionButton icon={<Pencil size={15} strokeWidth={1.8} />} title="Edit role" href={`/roles/${row.id}/edit`} />
        <IconActionButton
          icon={<Trash2 size={15} strokeWidth={1.8} />}
          title={row.isSystem ? "The Administrator role can't be deleted" : "Delete role"}
          tone="danger"
          onClick={onDelete}
          disabled={!canDelete || row.isSystem}
        />
      </span>
    </div>
  );
}

// Roles table body: server data comes in as props; the action buttons and
// the delete confirmation are client state. Delete is disabled until a
// deleteAction is passed (the server enforces the lockout guards).
export default function RoleTable({
  rows,
  deleteAction,
}: {
  rows: RoleRow[];
  deleteAction?: (id: string) => Promise<RoleDeleteResult>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<RoleRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirmDelete() {
    if (!deleteAction || !confirming) return;
    const target = confirming;
    startTransition(async () => {
      const result = await deleteAction(target.id);
      setConfirming(null);
      if (result.ok) {
        toast.success(`Role "${target.name}" deleted.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={ShieldCheck} message="No roles found." />;
  }

  return (
    <>
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
        }}
      >
        <span style={header}>Name</span>
        <span style={header}>Date</span>
        <span style={{ ...header, textAlign: "right" }}>Action</span>
      </div>

      {rows.map((row) => (
        <RoleTableRow key={row.id} row={row} onDelete={() => setConfirming(row)} canDelete={!!deleteAction} />
      ))}

      {confirming && (
        <ConfirmDeleteModal
          title="Delete role"
          message={`Are you sure you want to delete the role "${confirming.name}"? This can't be undone from here.`}
          pending={isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}
