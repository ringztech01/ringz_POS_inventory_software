"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { DAY_START_CHOICES, dayStartLabel } from "../../lib/reportTabs";
import { saveReportSettings } from "../../server/actions/reportSettings";

const field = { height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff", color: COLORS.ink } as const;

// Restaurant › Touch POS › Reports: when the business day starts for
// Restaurant Reports (with 04:00, an order closed at 01:30 counts on the day
// before), and the cash variance limit (Shifts & cash-up: a cash-up over or
// short by more shows red).
export default function ReportSettingsForm({ initial }: { initial: { dayStartMinutes: number; varianceLimit: string } }) {
  const [minutes, setMinutes] = useState(initial.dayStartMinutes);
  const [limit, setLimit] = useState(initial.varianceLimit);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = minutes !== saved.dayStartMinutes || limit.trim() !== saved.varianceLimit;

  async function save() {
    setSaving(true);
    try {
      const result = await saveReportSettings({ minutes, varianceLimit: limit });
      if (result.ok) {
        setSaved({ dayStartMinutes: minutes, varianceLimit: limit.trim() });
        toast.success("Report settings saved.");
      } else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setSaving(false);
  }

  return (
    <div data-day-start-settings data-report-settings style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Reports</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text }}>
          The business day starts at
          <select aria-label="The day starts at" data-day-start value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} style={{ ...field, minWidth: 110 }}>
            {DAY_START_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {dayStartLabel(choice)}
                {choice === 0 ? " (midnight)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>If you serve past midnight, pick a later time: with 04:00, an order closed at 01:30 counts on the day before.</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text }}>
          Cash variance limit ₦
          <input aria-label="Cash variance limit" data-variance-limit inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} style={{ ...field, width: 120 }} />
        </label>
        <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>In Shifts &amp; cash-up, a till counted over or short by more than this shows red.</span>
      </div>
      <button
        type="button"
        data-save-day-start
        disabled={!changed || saving}
        onClick={save}
        style={{ alignSelf: "flex-start", height: 38, padding: "0 18px", border: "none", borderRadius: 8, background: changed && !saving ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: changed && !saving ? "pointer" : "not-allowed" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
