import type { LucideIcon } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { KPI_TONES, type KpiTone } from "../../lib/theme";

// One of the dashboard's eight KPI tiles (RingzPOS Restaurant Dashboard).
// `value` null means its widget failed to load.
export default function KpiTile({
  label,
  value,
  note,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | null;
  note: string;
  tone: KpiTone;
  icon: LucideIcon;
}) {
  const c = KPI_TONES[tone];
  const failed = value === null;
  return (
    <div
      data-kpi={label}
      style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: c.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} strokeWidth={2} aria-hidden />
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: c.ink }}>{label}</span>
      </div>
      <span data-kpi-value style={{ fontFamily: FONTS.display, fontSize: 26, fontWeight: 600, color: failed ? COLORS.slateLight : COLORS.ink }}>
        {failed ? "—" : value}
      </span>
      <span data-kpi-note role={failed ? "alert" : undefined} style={{ fontSize: 12.5, fontWeight: 500, color: c.ink }}>
        {failed ? "Couldn't load this figure. Refresh to try again." : note}
      </span>
    </div>
  );
}
