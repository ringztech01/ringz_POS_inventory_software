"use client";

import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { CANCEL_DETAILS_MAX, CANCEL_REASONS, type CancelReason } from "../../lib/cancelReasons";
import type { Approver } from "../../server/queries/approvers";

export type CancelExtras = { wasted: boolean; approval?: { approverId: string; pin: string } };
// What the server said: refusals with a PIN request are shown here.
export type CancelOutcome = { ok: true } | { ok: false; error?: string; needsApproval?: boolean };

// Cancel a sent line, or the whole order: a reason from the list, plus free
// text (required for Other). The server records it with who and when.
// Returned by guest (a served line) asks whether the food was wasted, when
// `askWasted` (Log Waste): yes logs it as waste with the cancel — above the
// approval limit the server asks for an approver's PIN, shown here.
export default function CancelModal({
  title,
  message,
  confirmLabel,
  reasons,
  askWasted = false,
  approvers = [],
  onSubmit,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  reasons: CancelReason[];
  askWasted?: boolean;
  // Approve Waste users with a PIN (for waste over the limit).
  approvers?: Approver[];
  onSubmit: (reason: CancelReason, details: string, extras: CancelExtras) => Promise<CancelOutcome>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [details, setDetails] = useState("");
  const [wasted, setWasted] = useState<boolean | null>(null);
  const [askPin, setAskPin] = useState(false);
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wastedAsked = askWasted && reason === "RETURNED_BY_GUEST";
  const ready =
    !!reason &&
    (reason !== "OTHER" || details.trim() !== "") &&
    (!wastedAsked || wasted !== null) &&
    (!askPin || (approverId !== "" && pin.length >= 4)) &&
    !saving;

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
    setError(null);
    const isWasted = wastedAsked && wasted === true;
    const outcome = await onSubmit(reason, details, { wasted: isWasted, approval: isWasted && askPin ? { approverId, pin } : undefined });
    setSaving(false);
    if (outcome.ok) return onClose();
    if (outcome.error) setError(outcome.error);
    if (outcome.needsApproval) setAskPin(true);
    setPin("");
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
          {reasons.map((key) => {
            const label = CANCEL_REASONS[key];
            const on = reason === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setReason(key);
                  setAskPin(false);
                  setError(null);
                }}
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

        {wastedAsked && (
          <div role="radiogroup" aria-label="Was the food wasted?" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: COLORS.bgApp }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Was the food wasted?</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(
                [
                  [true, "Yes, log it as waste"],
                  [false, "No"],
                ] as const
              ).map(([value, text]) => {
                const on = wasted === value;
                return (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setWasted(value);
                      setAskPin(false);
                      setError(null);
                    }}
                    style={{ height: 40, border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: on ? 600 : 400, cursor: "pointer" }}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
            {wasted && <span style={{ fontSize: 12, color: COLORS.slateMid }}>Its ingredients come out of stock as Returned by guest waste (Food › Waste).</span>}
          </div>
        )}

        {askPin && (
          <div aria-label="Approval" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: COLORS.bgApp }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={14} strokeWidth={1.8} /> Approval needed for the waste
            </span>
            {approvers.length === 0 ? (
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>No one with Approve Waste has set an approval PIN yet.</span>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select aria-label="Approver" value={approverId} onChange={(event) => setApproverId(event.target.value)} style={{ height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff" }}>
                  <option value="">Choose the approver…</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Approver PIN"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Their PIN"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                  style={{ height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13, letterSpacing: ".3em" }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
            {error}
          </p>
        )}

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
