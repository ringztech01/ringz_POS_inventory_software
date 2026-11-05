"use client";

import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { DISCOUNT_REASON_MAX } from "../../schemas/bill";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";

export type DiscountRequest = {
  type: "PERCENT" | "AMOUNT";
  value: string;
  reason: string;
  approval?: { approverId: string; pin: string };
};
// What the server said: refusals are shown here, not as toasts.
export type DiscountOutcome = { ok: true } | { ok: false; error: string; needsApproval?: boolean };

const field = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none" } as const;

// Discount on the bill: % off or ₦ off, with a reason. Up to the limit it
// saves straight away; above it the server asks for an approver (someone
// with Approve Discount) and their PIN, which then show here. The server
// works out the amount and checks the limit — this only sends what's typed.
export default function DiscountModal({
  bill,
  approvers,
  onSubmit,
  onClose,
}: {
  bill: BillView;
  approvers: Approver[];
  onSubmit: (request: DiscountRequest) => Promise<DiscountOutcome>;
  onClose: () => void;
}) {
  const current = bill.discount;
  const [type, setType] = useState<DiscountRequest["type"]>(current?.type ?? "PERCENT");
  const [value, setValue] = useState(current?.value ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [askApproval, setAskApproval] = useState(false);
  const [approverId, setApproverId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = value.trim() !== "" && reason.trim() !== "" && (!askApproval || (approverId !== "" && pin.length >= 4)) && !saving;

  async function send(request: DiscountRequest) {
    setSaving(true);
    setError(null);
    const outcome = await onSubmit(request);
    setSaving(false);
    if (outcome.ok) return onClose();
    setError(outcome.error);
    if (outcome.needsApproval) setAskApproval(true);
    setPin("");
  }

  function apply() {
    if (!ready) return;
    void send({ type, value: value.trim(), reason: reason.trim(), approval: askApproval ? { approverId, pin } : undefined });
  }

  return (
    // Shown over the Bill panel: a click outside closes this pop-up only.
    <div
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90 }}
    >
      <div
        role="dialog"
        aria-label="Discount"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 420, background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Discount · {bill.order.ref}</span>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.slate }}>
          Off the sub total ({bill.totals.subTotal}). Over {bill.discountLimit} needs an approver&apos;s PIN.
        </p>

        <div role="radiogroup" aria-label="Discount type" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(
            [
              ["PERCENT", "% off"],
              ["AMOUNT", "₦ off"],
            ] as const
          ).map(([key, label]) => {
            const on = type === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setType(key);
                  setAskApproval(false);
                  setError(null);
                }}
                style={{ height: 38, border: on ? `2px solid ${COLORS.teal}` : `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", fontSize: 13.5, fontWeight: on ? 600 : 400, cursor: "pointer" }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          aria-label={type === "PERCENT" ? "Percent off" : "Amount off"}
          inputMode="decimal"
          placeholder={type === "PERCENT" ? "e.g. 10" : "e.g. 2000"}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setAskApproval(false);
          }}
          style={field}
        />
        <input aria-label="Reason" placeholder="Reason (required), e.g. Regular guest" value={reason} maxLength={DISCOUNT_REASON_MAX} onChange={(event) => setReason(event.target.value)} style={field} />

        {askApproval && (
          <div aria-label="Approval" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10, background: COLORS.bgApp }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={14} strokeWidth={1.8} /> Approval needed
            </span>
            {approvers.length === 0 ? (
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>No one with Approve Discount has set an approval PIN yet.</span>
            ) : (
              <>
                <select aria-label="Approver" value={approverId} onChange={(event) => setApproverId(event.target.value)} style={{ ...field, background: "#fff" }}>
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
                  onKeyDown={(event) => event.key === "Enter" && apply()}
                  style={{ ...field, background: "#fff", letterSpacing: ".3em" }}
                />
              </>
            )}
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
            {error}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: current ? "1fr 1fr" : "1fr", gap: 8 }}>
          {current && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void send({ type: current.type, value: "0", reason: "" })}
              style={{ height: 44, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 9, background: "#fff", color: COLORS.danger, fontSize: 14, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
            >
              Remove discount
            </button>
          )}
          <button
            type="button"
            onClick={apply}
            disabled={!ready}
            style={{ height: 44, border: "none", borderRadius: 9, background: ready ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed" }}
          >
            {saving ? "Saving…" : askApproval ? "Approve & apply" : "Apply discount"}
          </button>
        </div>
      </div>
    </div>
  );
}
