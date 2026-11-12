"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { DAY_START_CHOICES, dayStartLabel } from "../../lib/reportTabs";
import { saveDayStart } from "../../server/actions/reportSettings";

// Restaurant › Touch POS › Business day: when the day starts for Restaurant
// Reports. With 04:00, an order closed at 01:30 counts on the day before.
export default function DayStartForm({ initial }: { initial: number }) {
  const [minutes, setMinutes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = minutes !== saved;

  async function save() {
    setSaving(true);
    try {
      const result = await saveDayStart({ minutes });
      if (result.ok) {
        setSaved(minutes);
        toast.success("Business day saved.");
      } else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setSaving(false);
  }

  return (
    <div data-day-start-settings style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Business day</span>
      <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
        When the day starts in Restaurant Reports. If you serve past midnight, pick a later time: with 04:00, an order closed at 01:30 counts on the day before.
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text }}>
          The day starts at
          <select
            aria-label="The day starts at"
            data-day-start
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            style={{ height: 38, minWidth: 110, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff", color: COLORS.ink }}
          >
            {DAY_START_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {dayStartLabel(choice)}
                {choice === 0 ? " (midnight)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-save-day-start
          disabled={!changed || saving}
          onClick={save}
          style={{ height: 38, padding: "0 18px", border: "none", borderRadius: 8, background: changed && !saving ? COLORS.teal : COLORS.slateLight, color: "#fff", fontSize: 14, fontWeight: 600, cursor: changed && !saving ? "pointer" : "not-allowed" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
