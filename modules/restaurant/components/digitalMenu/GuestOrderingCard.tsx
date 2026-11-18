"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ShoppingBag } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { GUEST_MAX_LINES_LIMIT } from "../../lib/guestOrdering";
import { saveGuestOrderingAction } from "../../server/actions/guestOrders";

// Digital menu › Guest ordering (Part 8 Step 7): whether guests can order
// from a table's menu (off until switched on), whether a waiter confirms
// their lines first (the default) or they go straight to the kitchen, and
// the caps on one order. Paused from the dashboard; shown here.

export type GuestOrderingView = { enabled: boolean; requireWaiterConfirm: boolean; autoSend: boolean; maxLines: number; maxValue: string | null; paused: boolean };

const field = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff", color: COLORS.ink } as const;

function Tick({ on, label, help, disabled, onChange, data }: { on: boolean; label: string; help: string; disabled?: boolean; onChange: (on: boolean) => void; data: string }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" data-ordering-setting={data} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 17, height: 17, marginTop: 2, accentColor: COLORS.teal }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink }}>{label}</span>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{help}</span>
      </span>
    </label>
  );
}

// "100000.00" → "100,000"; "" for none.
const shown = (value: string | null) => (value === null ? "" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value)));

export default function GuestOrderingCard({ settings }: { settings: GuestOrderingView }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...settings, maxLines: String(settings.maxLines), maxValue: shown(settings.maxValue) });
  const [saving, setSaving] = useState(false);
  const changed =
    form.enabled !== settings.enabled ||
    form.requireWaiterConfirm !== settings.requireWaiterConfirm ||
    form.autoSend !== settings.autoSend ||
    form.maxLines !== String(settings.maxLines) ||
    form.maxValue !== shown(settings.maxValue);

  async function save() {
    setSaving(true);
    try {
      const result = await saveGuestOrderingAction({
        enabled: form.enabled,
        requireWaiterConfirm: form.requireWaiterConfirm,
        autoSend: form.autoSend,
        maxLines: Number(form.maxLines),
        maxValue: form.maxValue.trim() || null,
      });
      if (result.ok) {
        toast.success(form.enabled ? "Guest ordering saved." : "Guest ordering is off.");
        router.refresh();
      } else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setSaving(false);
  }

  return (
    <section data-menu-ordering style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <ShoppingBag size={16} strokeWidth={1.8} /> Guest ordering
        {settings.enabled && settings.paused && <span data-ordering-paused style={{ fontSize: 11.5, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "1px 8px" }}>Paused on the dashboard</span>}
      </span>
      <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
        Guests at a table pick dishes and options on their phone and send them. The server prices every line itself, and only phones on the restaurant&apos;s Wi-Fi can send. Guests can&apos;t void, discount or pay.
      </span>
      <Tick data="enabled" on={form.enabled} label="Guests can order from the menu" help="Off: the menu is for looking only." onChange={(enabled) => setForm({ ...form, enabled })} />
      <Tick
        data="requireWaiterConfirm"
        on={form.requireWaiterConfirm}
        disabled={!form.enabled || form.autoSend}
        label="A waiter confirms each order first"
        help="Guest lines wait on the order (violet, with Confirm and Reject) until a waiter confirms them, then they're sent as usual. Off: they go straight onto the order as unsent lines."
        onChange={(requireWaiterConfirm) => setForm({ ...form, requireWaiterConfirm })}
      />
      <Tick
        data="autoSend"
        on={form.autoSend}
        disabled={!form.enabled}
        label="Send guest orders straight to the kitchen"
        help="No waiter in between: tickets print at the kitchen at once. Leave this off unless your staff watch the floor closely."
        onChange={(autoSend) => setForm({ ...form, autoSend })}
      />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: COLORS.slateMid }}>
          Lines per order (at most)
          <input data-ordering-max-lines type="number" min={1} max={GUEST_MAX_LINES_LIMIT} value={form.maxLines} disabled={!form.enabled} onChange={(e) => setForm({ ...form, maxLines: e.target.value })} style={{ ...field, width: 120, fontFamily: FONTS.mono }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: COLORS.slateMid }}>
          Value per order (₦, at most — empty for no cap)
          <input data-ordering-max-value inputMode="decimal" value={form.maxValue} disabled={!form.enabled} placeholder="No cap" onChange={(e) => setForm({ ...form, maxValue: e.target.value })} style={{ ...field, width: 200, fontFamily: FONTS.mono }} />
        </label>
        <button
          type="button"
          data-ordering-save
          disabled={!changed || saving}
          onClick={() => void save()}
          style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 8, background: !changed || saving ? COLORS.bgApp : COLORS.teal, color: !changed || saving ? COLORS.slateLight : "#fff", fontSize: 13, fontWeight: 600, cursor: !changed || saving ? "not-allowed" : "pointer" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
