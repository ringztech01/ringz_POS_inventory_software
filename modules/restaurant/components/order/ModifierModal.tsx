"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { checkSelection, NOTE_MAX } from "../../lib/modifiers";
import type { ModifierGroupView } from "../../server/queries/modifiers";

const groupLabel = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

// The options pop-up (Table Order design): each group with its rule
// ("Portion · required", "Extras · up to 2"), options with their price change
// ("+₦4.00"), a kitchen note (140 characters). Add to order stays disabled
// until every group's rule is met; the server checks again. The pencil opens
// it with a line's current options and note.
export default function ModifierModal({
  title,
  groups,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  groups: ModifierGroupView[];
  initial: { modifierIds: string[]; note: string } | null;
  submitLabel: string;
  // Resolves true when the server accepted it (the pop-up then closes).
  onSubmit: (modifierIds: string[], note: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial?.modifierIds ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const problem = checkSelection(
    groups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, optionIds: g.options.map((o) => o.id) })),
    selected,
  );

  function toggle(group: ModifierGroupView, optionId: string) {
    setSelected((current) => {
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      const inGroup = current.filter((id) => group.options.some((o) => o.id === id));
      // One choice: the new one replaces it. Several: up to the group's limit.
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), optionId];
      return inGroup.length >= group.maxSelect ? current : [...current, optionId];
    });
  }

  async function submit() {
    if (problem || saving) return;
    setSaving(true);
    const accepted = await onSubmit(selected, note);
    setSaving(false);
    if (accepted) onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-label={`${title} options`}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 440, background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((group, index) => {
            const single = group.maxSelect === 1;
            const full = !single && group.options.filter((o) => selected.includes(o.id)).length >= group.maxSelect;
            return (
              <div key={group.id} data-group={group.name} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: index ? 6 : 0 }}>
                <span style={groupLabel}>
                  {group.name} · {group.rule}
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {group.options.map((option) => {
                    const on = selected.includes(option.id);
                    const blocked = !on && full;
                    const label = option.price ? `${option.name} ${option.price}` : option.name;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={on}
                        disabled={blocked}
                        onClick={() => toggle(group, option.id)}
                        style={
                          single
                            ? {
                                flex: "1 1 0",
                                minWidth: 110,
                                height: 40,
                                border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`,
                                borderRadius: 8,
                                background: "#fff",
                                fontSize: 13,
                                fontWeight: on ? 600 : 400,
                                color: COLORS.ink,
                                cursor: "pointer",
                              }
                            : {
                                height: 34,
                                padding: "0 12px",
                                border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`,
                                borderRadius: 17,
                                background: on ? COLORS.tealTint : "#fff",
                                fontSize: 13,
                                fontWeight: on ? 600 : 400,
                                color: COLORS.ink,
                                cursor: blocked ? "not-allowed" : "pointer",
                                opacity: blocked ? 0.5 : 1,
                              }
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <input
            aria-label="Note for kitchen"
            placeholder="Note for kitchen (e.g. no pepper)"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            style={{ height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13, marginTop: groups.length ? 6 : 0, outline: "none" }}
          />
          <span style={{ alignSelf: "flex-end", fontFamily: FONTS.mono, fontSize: 11, color: COLORS.slateLight }}>
            {note.length}/{NOTE_MAX}
          </span>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!!problem || saving}
          title={problem ?? undefined}
          style={{
            height: 44,
            border: "none",
            background: problem || saving ? COLORS.slateLight : COLORS.teal,
            color: "#fff",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: problem || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
