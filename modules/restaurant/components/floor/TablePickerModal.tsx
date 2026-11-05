"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import type { MoveMode } from "../../lib/tableMoves";
import { TABLE_STATUS_PILL } from "../../lib/theme";
import type { FloorTarget } from "../../server/queries/floor";

// Move table / Merge (Floor Plan side panel): pick the table. Move lists free
// tables (Available, or Reserved with a warning); Merge lists the other
// occupied tables — both in the order's warehouse. The server re-checks.
export default function TablePickerModal({
  mode,
  from,
  orderRef,
  options,
  onSubmit,
  onClose,
}: {
  mode: MoveMode;
  from: string;
  orderRef: string;
  options: FloorTarget[];
  // Resolves true when the server accepted it (the pop-up then closes).
  onSubmit: (target: FloorTarget) => Promise<boolean>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<FloorTarget | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!picked || saving) return;
    setSaving(true);
    const accepted = await onSubmit(picked);
    setSaving(false);
    if (accepted) onClose();
  }

  const move = mode === "move";
  const title = move ? `Move ${orderRef} from ${from}` : `Merge ${from} into another table`;
  const intro = move
    ? "Its lines and their kitchen states move with it. Pick a free table:"
    : `${from}'s lines join the other table's order, the guests are added together, and ${from} is freed. Pick the table:`;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 440, maxHeight: "80vh", background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate }}>{intro}</p>

        <div role="listbox" aria-label="Tables" style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", minHeight: 0 }}>
          {options.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
              {move ? "No free table in this warehouse right now." : "No other occupied table to merge into."}
            </p>
          ) : (
            options.map((option) => {
              const on = picked?.id === option.id;
              const [pillBg, pillFg] = TABLE_STATUS_PILL[option.status];
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-target={option.name}
                  onClick={() => setPicked(option)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`,
                    borderRadius: 9,
                    background: "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontFamily: FONTS.display, fontSize: 16, fontWeight: 600, minWidth: 44 }}>{option.name}</span>
                  <span style={{ flex: 1, fontSize: 13, color: COLORS.slateMid }}>
                    {option.areaName}
                    {option.orderRef ? ` · ${option.orderRef}` : ""}
                  </span>
                  <span style={{ height: 22, padding: "0 9px", borderRadius: 11, background: pillBg, color: pillFg, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center" }}>
                    {option.status}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {move && picked?.status === "Reserved" && (
          <p role="alert" style={{ margin: 0, padding: "10px 12px", borderRadius: 9, background: "#fff4e0", color: "#8a5a00", fontSize: 13 }}>
            {picked.name} is reserved{picked.booking ? ` (${picked.booking})` : ""}. The booking stays — seat that party somewhere else when they arrive.
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!picked || saving}
          style={{
            height: 44,
            border: "none",
            background: picked && !saving ? COLORS.teal : COLORS.slateLight,
            color: "#fff",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: picked && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : !picked ? "Pick a table" : move ? `Move to ${picked.name}` : `Merge into ${picked.name}`}
        </button>
      </div>
    </div>
  );
}
