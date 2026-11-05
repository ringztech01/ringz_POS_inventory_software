"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { formatAppDateTime } from "../../lib/time";
import { saveApprovalPin } from "../../server/actions/bill";

const field = { height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 15, letterSpacing: ".3em", outline: "none" } as const;
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

// Set or change the PIN typed to approve a discount or waste above its
// limit. Only its hash is kept; nobody can read it back.
export default function ApprovalPinForm({ hasPin, updatedAt }: { hasPin: boolean; updatedAt: string | null }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ pin?: string; confirm?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const ready = pin.length >= 4 && confirm.length >= 4 && !saving;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setErrors({});
    try {
      const result = await saveApprovalPin({ pin, confirm });
      if (result.ok) {
        toast.success(hasPin ? "Approval PIN changed." : "Approval PIN set.");
        setPin("");
        setConfirm("");
      } else {
        setErrors({ pin: result.fieldErrors?.pin?.[0], confirm: result.fieldErrors?.confirm?.[0], form: result.fieldErrors ? undefined : result.error });
      }
    } catch {
      setErrors({ form: "Couldn't reach the server. Check the connection and try again." });
    }
    setSaving(false);
  }

  return (
    <form
      onSubmit={save}
      style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}
    >
      <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slate, display: "flex", gap: 8 }}>
        <KeyRound size={16} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1, color: COLORS.tealDark }} />
        <span>
          When a discount or waste needs approving, you&apos;re picked from the list and type this PIN on that screen. 4 to 6 digits; keep it to yourself.
        </span>
      </p>
      <span data-pin-status style={{ fontSize: 12.5, color: COLORS.slateMid }}>
        {hasPin && updatedAt ? `Your PIN was set ${formatAppDateTime(new Date(updatedAt))}.` : "You haven't set a PIN yet."}
      </span>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        {hasPin ? "New PIN" : "PIN"}
        <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} style={field} />
        {errors.pin && <span style={{ fontSize: 12.5, fontWeight: 400, color: COLORS.danger }}>{errors.pin}</span>}
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        Type it again
        <input type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} style={field} />
        {errors.confirm && <span style={{ fontSize: 12.5, fontWeight: 400, color: COLORS.danger }}>{errors.confirm}</span>}
      </label>
      {errors.form && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>
          {errors.form}
        </p>
      )}
      <button
        type="submit"
        disabled={!ready}
        style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: ready ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed" }}
      >
        {saving ? "Saving…" : hasPin ? "Change PIN" : "Set PIN"}
      </button>
    </form>
  );
}
