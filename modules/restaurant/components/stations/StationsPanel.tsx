"use client";

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import { R } from "../../lib/theme";
import type { StationRow } from "../../server/queries/stations";
import { deleteStation } from "../../server/actions/stations";
import StationModal, { type EditableStation } from "./StationModal";

const openLinesNote = (n: number) => `It has ${n} ${n === 1 ? "line" : "lines"} in its kitchen right now — delete it once they have been served or cancelled.`;

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
        height: 36,
        padding: "0 14px",
        background: hover.value ? COLORS.tealDark : COLORS.teal,
        border: "none",
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: "#fff",
        cursor: "pointer",
      }}
    >
      + Add station
    </button>
  );
}

const th = { padding: "10px 12px", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid, textAlign: "left" } as const;
const td = { padding: "12px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5 } as const;

// Stations settings: the kitchen stations with their code, late limit and
// state, plus add / edit / delete. A station with lines in its kitchen
// can't be deleted (here and on the server).
export default function StationsPanel({ stations }: { stations: StationRow[] }) {
  const [editing, setEditing] = useState<EditableStation | "new" | null>(null);
  const [deleting, setDeleting] = useState<StationRow | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const nextSortOrder = stations.reduce((max, s) => Math.max(max, s.sortOrder + 1), 0);

  function askDelete(station: StationRow) {
    if (station.openLines > 0) toast.error(openLinesNote(station.openLines));
    else setDeleting(station);
  }

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteStation(deleting.id);
      setDeleting(null);
      if (result.ok) toast.success("Station deleted.");
      else toast.error(result.error);
    });
  }

  return (
    <section aria-label="Kitchen stations" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Kitchen stations</h2>
          <p data-note style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>
            Items without a station go to the first active station.
          </p>
        </div>
        <AddButton onClick={() => setEditing("new")} />
      </div>

      {stations.length === 0 ? (
        <p style={{ margin: 0, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          No stations yet. Add one — orders can&apos;t be sent to the kitchen without an active station.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Code</th>
              <th style={th}>Late after</th>
              <th style={th}>Dishes</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((station) => (
              <tr key={station.id} data-station={station.code}>
                <td style={{ ...td, fontWeight: 600 }}>{station.name}</td>
                <td style={{ ...td, fontFamily: FONTS.mono }}>{station.code}</td>
                <td style={{ ...td, fontFamily: FONTS.mono }}>{station.lateAfterMin} min</td>
                <td style={{ ...td, fontFamily: FONTS.mono, color: COLORS.slate }}>{station.dishes}</td>
                <td style={td}>
                  <span
                    style={{
                      height: 22,
                      padding: "0 9px",
                      borderRadius: 11,
                      display: "inline-flex",
                      alignItems: "center",
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: station.isActive ? COLORS.tealTint : COLORS.bgApp,
                      color: station.isActive ? COLORS.tealDark : COLORS.slateMid,
                    }}
                  >
                    {station.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <IconActionButton icon={<Pencil size={13} strokeWidth={1.8} />} title="Edit station" size={28} onClick={() => setEditing(station)} />
                    <IconActionButton
                      icon={<Trash2 size={13} strokeWidth={1.8} />}
                      title={station.openLines > 0 ? openLinesNote(station.openLines) : "Delete station"}
                      tone="danger"
                      baseColor={station.openLines > 0 ? COLORS.slateLight : undefined}
                      size={28}
                      onClick={() => askDelete(station)}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && <StationModal station={editing === "new" ? null : editing} nextSortOrder={nextSortOrder} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete station"
          message={`Delete "${deleting.name}"? Its ${deleting.dishes === 1 ? "dish goes" : `${deleting.dishes} dishes go`} back to no station (sent to the first active station), and its past tickets keep its name.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </section>
  );
}
