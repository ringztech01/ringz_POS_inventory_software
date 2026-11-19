"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { savePaymentSettings } from "../../server/actions/pos";
import type { PaymentSettings } from "../../server/services/paymentSettings";

// Settings › Restaurant › Payments: the tablet's tip step.
export default function PaymentSettingsForm({ initial }: { initial: PaymentSettings }) {
  const [saved, setSaved] = useState(initial);
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = settings.tabletTips !== saved.tabletTips;

  async function save() {
    setSaving(true);
    try {
      const result = await savePaymentSettings(settings);
      if (result.ok) {
        setSaved(settings);
        toast.success("Payment settings saved.");
      } else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setSaving(false);
  }

  const choice = (value: boolean, label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text, cursor: "pointer" }}>
      <input type="radio" name="tabletTips" data-tablet-tips={value ? "on" : "off"} checked={settings.tabletTips === value} onChange={() => setSettings({ tabletTips: value })} style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
      {label}
    </label>
  );

  return (
    <div data-payment-settings style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Tips on the tablet</legend>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
          Whether a tablet&apos;s PAY asks for a tip before the payment. A tip goes to the order&apos;s waiter. The desktop Payment pop-up always has its own Tip field.
        </span>
        {choice(false, "No tip step")}
        {choice(true, "Ask for a tip (no tip, 5%, 10%, 15% or an amount)")}
      </fieldset>
      <button
        type="button"
        data-save-payment-settings
        disabled={!changed || saving}
        onClick={save}
        style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: changed && !saving ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: changed && !saving ? "pointer" : "not-allowed" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
