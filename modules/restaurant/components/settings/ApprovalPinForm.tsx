"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { formatAppDateTime } from "../../lib/time";
import { changeOwnPin } from "../../server/actions/staff";

const field = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 15, letterSpacing: ".3em", outline: "none" } as const;
const digits = (value: string, max = 4) => value.replace(/\D/g, "").slice(0, max);

// My PIN (Part 6f): an Administrator sets PINs (Settings › Staff). Changing
// your own is allowed only when the Administrator turns it on, and needs
// your current PIN; the new one follows the same rules (4 digits, nobody
// else's, not easy to guess). Only its hash is kept.
export default function ApprovalPinForm({ hasPin, updatedAt, selfPin, oldPin }: { hasPin: boolean; updatedAt: string | null; selfPin: boolean; oldPin: boolean }) {
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canChange = selfPin && hasPin;
  const ready = canChange && current.length >= 4 && pin.length === 4 && confirm.length === 4 && !saving;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError("");
    const result = await changeOwnPin({ oldPin: current, pin, confirm }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
    setSaving(false);
    if (!result.ok) return setError(result.error);
    toast.success("PIN changed.");
    setCurrent("");
    setPin("");
    setConfirm("");
  }

  return (
    <form onSubmit={save} style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, display: "flex", gap: 8 }}>
        <KeyRound size={16} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1, color: COLORS.tealDark }} />
        <span>Your PIN signs you in on the touch POS and, if you approve discounts, voids or waste, it&apos;s the PIN you type to approve them. Keep it to yourself.</span>
      </p>
      <span data-pin-status style={{ fontSize: 12.5, color: COLORS.slateMid }}>
        {hasPin && updatedAt ? `Your PIN was set ${formatAppDateTime(new Date(updatedAt))}.` : "You haven't a PIN yet."}
        {hasPin && oldPin ? " It was set before the current rules — ask an Administrator for a new one." : ""}
      </span>
      {!canChange ? (
        <p data-pin-admin-only style={{ margin: 0, fontSize: 13.5, color: COLORS.ink, background: COLORS.bgApp, borderRadius: 8, padding: "12px 14px" }}>
          {selfPin ? "Ask an Administrator to set your first PIN (Settings › Staff)." : "PINs are set by an Administrator (Settings › Staff). Ask them if you need a new one."}
        </p>
      ) : (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
            Current PIN
            <input data-pin-current type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(digits(e.target.value, 6))} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
            New PIN (4 digits)
            <input data-pin-new type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
            Type it again
            <input data-pin-confirm type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} style={field} />
          </label>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            data-pin-save
            disabled={!ready}
            style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: ready ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed" }}
          >
            {saving ? "Saving…" : "Change PIN"}
          </button>
        </>
      )}
    </form>
  );
}
