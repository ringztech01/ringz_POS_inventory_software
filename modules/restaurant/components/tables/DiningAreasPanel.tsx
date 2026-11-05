"use client";

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import type { SelectOption } from "@/components/purchases/form-fields";
import { R } from "../../lib/theme";
import type { DiningAreaRow } from "../../server/queries/diningAreas";
import { deleteDiningArea } from "../../server/actions/diningAreas";
import DiningAreaModal, { type EditableArea } from "./DiningAreaModal";

const HAS_TABLES = "Move or delete its tables first.";

function AddButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        marginLeft: "auto",
        height: 32,
        padding: "0 10px",
        background: hover.value ? COLORS.tealTint : "#fff",
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 7,
        fontSize: 12.5,
        fontWeight: 600,
        color: COLORS.tealDark,
        cursor: "pointer",
      }}
    >
      + Add area
    </button>
  );
}

// RingzPOS Tables design, right panel: the dining areas with their warehouse
// and table count, plus add / edit / delete. Deleting an area that still has
// tables is refused (here and on the server).
export default function DiningAreasPanel({ areas, warehouses }: { areas: DiningAreaRow[]; warehouses: SelectOption[] }) {
  const [editing, setEditing] = useState<EditableArea | "new" | null>(null);
  const [deleting, setDeleting] = useState<DiningAreaRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  function askDelete(area: DiningAreaRow) {
    if (area.tableCount > 0) toast.error(HAS_TABLES);
    else setDeleting(area);
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteDiningArea(deleting.id);
      setDeleting(null);
      if (result.ok) {
        toast.success("Dining area deleted.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <section
      aria-label="Dining areas"
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Dining areas</h2>
        <AddButton onClick={() => setEditing("new")} />
      </div>

      {areas.length === 0 ? (
        <p style={{ margin: 0, padding: "8px 0", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          No dining areas yet. Add one to start placing tables.
        </p>
      ) : (
        areas.map((area) => (
          <div
            key={area.id}
            data-area={area.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderTop: `1px solid ${R.rowBorder}`,
              fontSize: 13.5,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {area.name}
            </span>
            <span style={{ color: COLORS.slateMid }}>{area.warehouseName}</span>
            <span style={{ fontFamily: FONTS.mono, color: COLORS.slate, width: 70, textAlign: "right" }}>
              {area.tableCount} {area.tableCount === 1 ? "table" : "tables"}
            </span>
            <span style={{ display: "flex", gap: 6, marginLeft: 4 }}>
              <IconActionButton
                icon={<Pencil size={13} strokeWidth={1.8} />}
                title="Edit area"
                size={28}
                onClick={() => setEditing({ id: area.id, name: area.name, warehouseId: area.warehouseId })}
              />
              <IconActionButton
                icon={<Trash2 size={13} strokeWidth={1.8} />}
                title={area.tableCount > 0 ? HAS_TABLES : "Delete area"}
                tone="danger"
                baseColor={area.tableCount > 0 ? COLORS.slateLight : undefined}
                size={28}
                onClick={() => askDelete(area)}
              />
            </span>
          </div>
        ))
      )}

      {editing && (
        <DiningAreaModal area={editing === "new" ? null : editing} warehouses={warehouses} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete dining area"
          message={`Delete "${deleting.name}"? It has no tables, and it will no longer appear on the floor plan.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </section>
  );
}
