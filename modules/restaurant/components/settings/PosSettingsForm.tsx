"use client";

import { useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { LOCK_CHOICES, MANAGER_LOCK_CHOICES } from "../../schemas/pos";
import { savePosSettings } from "../../server/actions/pos";
import type { PosSettings } from "../../server/queries/posScreen";

const lockLabel = (seconds: number) => (seconds === 0 ? "Never" : seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds === 60 ? "" : "s"}`);

function Choice<T extends string | number | boolean>({ name, value, current, onPick, children }: { name: string; value: T; current: T; onPick: (value: T) => void; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text, cursor: "pointer" }}>
      <input type="radio" name={name} checked={current === value} onChange={() => onPick(value)} style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
      {children}
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{title}</legend>
      <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{hint}</span>
      {children}
    </fieldset>
  );
}

// Restaurant › Touch POS: how /pos behaves on the floor.
export default function PosSettingsForm({ initial }: { initial: PosSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PosSettings>(key: K) => (value: PosSettings[K]) => setSettings((now) => ({ ...now, [key]: value }));
  const changed = JSON.stringify(settings) !== JSON.stringify(initial);

  async function save() {
    setSaving(true);
    try {
      const result = await savePosSettings(settings);
      if (result.ok) toast.success("Touch POS settings saved.");
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setSaving(false);
  }

  return (
    <div data-pos-settings style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 22 }}>
      <Section title="After a dish is added" hint="Where the menu buttons go once a dish is on the check.">
        <Choice name="returnHome" value={false} current={settings.returnHome} onPick={set("returnHome")}>
          Stay on that page of buttons (the next dish is one tap away)
        </Choice>
        <Choice name="returnHome" value={true} current={settings.returnHome} onPick={set("returnHome")}>
          Back to the Food / Bar home
        </Choice>
      </Section>
      <Section title="After Send" hint="Once the lines have gone to the kitchen and bar.">
        <Choice name="sendToFloor" value={true} current={settings.sendToFloor} onPick={set("sendToFloor")}>
          Back to the floor plan, for the next table
        </Choice>
        <Choice name="sendToFloor" value={false} current={settings.sendToFloor} onPick={set("sendToFloor")}>
          Stay on the order
        </Choice>
      </Section>
      <Section title="Theme" hint="Every till. The dark frame reads best under bar lighting; the light one in daylight.">
        <Choice name="lightTheme" value={false} current={settings.lightTheme} onPick={set("lightTheme")}>
          Dark
        </Choice>
        <Choice name="lightTheme" value={true} current={settings.lightTheme} onPick={set("lightTheme")}>
          Light
        </Choice>
      </Section>
      <Section title="Lock the screen" hint="After this long without a tap, the POS locks (never while a payment is open). On a PIN terminal the session ends and the PIN screen comes back; elsewhere a PIN opens it (and makes it theirs).">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {LOCK_CHOICES.map((seconds) => (
            <Choice key={seconds} name="lockSeconds" value={seconds as number} current={settings.lockSeconds} onPick={set("lockSeconds")}>
              {lockLabel(seconds)}
            </Choice>
          ))}
        </div>
      </Section>
      <Section title="Lock the screen — Managers" hint={settings.lockSeconds === 0 ? "Managers and the Administrator. Used once the screen locks at all (above)." : "Managers and the Administrator, who are often away from the till longer."}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, opacity: settings.lockSeconds === 0 ? 0.5 : 1 }}>
          {MANAGER_LOCK_CHOICES.map((seconds) => (
            <Choice key={seconds} name="lockSecondsManager" value={seconds as number} current={settings.lockSecondsManager} onPick={set("lockSecondsManager")}>
              {lockLabel(seconds)}
            </Choice>
          ))}
        </div>
      </Section>
      <button
        type="button"
        data-save-pos-settings
        disabled={!changed || saving}
        onClick={save}
        style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: changed && !saving ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: changed && !saving ? "pointer" : "not-allowed" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
