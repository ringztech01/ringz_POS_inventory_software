"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { CANCEL_DETAILS_MAX, CANCEL_REASONS, type CancelReason } from "../../lib/cancelReasons";

const REASONS = Object.entries(CANCEL_REASONS) as [CancelReason, string][];

// Cancel a sent line, or the whole order: a reason from the list, plus free
// text (required for Other). The server records it with who and when.
export default function CancelModal({
  title,
  message,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  // Resolves true when the server accepted it (the pop-up then closes).
  onSubmit: (reason: CancelReason, details: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = !!reason && (reason !== "OTHER" || details.trim() !== "") && !saving;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!ready || !reason) return;
    setSaving(true);
    const accepted = await onSubmit(reason, details);
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
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 420, background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate }}>{message}</p>

        <div role="radiogroup" aria-label="Reason" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {REASONS.map(([key, label]) => {
            const on = reason === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setReason(key)}
                style={{
                  height: 40,
                  border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 8,
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: on ? 600 : 400,
                  color: COLORS.ink,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          aria-label="Details"
          placeholder={reason === "OTHER" ? "What happened? (required)" : "Details (optional)"}
          value={details}
          maxLength={CANCEL_DETAILS_MAX}
          onChange={(event) => setDetails(event.target.value)}
          style={{ height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13, outline: "none" }}
        />

        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          style={{
            height: 44,
            border: "none",
            background: ready ? COLORS.danger : COLORS.slateLight,
            color: "#fff",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Cancelling…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}
