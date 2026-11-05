import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import type { HourChart } from "../../lib/dashboard";
import { HOUR_BAR } from "../../lib/theme";
import DashboardCard from "./DashboardCard";

// Sales by hour: one bar per hour of billed revenue, the peak hour in teal
// with its "Peak 13:00 · ₦amount" label. Hovering a bar names its hour and
// amount; the same figures are in a table for screen readers.
export default function SalesByHour({ chart }: { chart: HourChart | null }) {
  const peak = chart?.peak;
  return (
    <DashboardCard
      title="Sales by hour"
      failed={!chart}
      aside={
        <span data-peak style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.slateMid }}>
          {peak ? `Peak ${peak.label} · ${formatNaira(peak.total)}` : "No sales yet"}
        </span>
      }
    >
      {chart && (
        <>
          <div style={{ marginTop: 4, position: "relative" }} aria-hidden>
            <div style={{ height: 200, display: "flex", alignItems: "flex-end", gap: 8, borderBottom: `1px solid ${COLORS.border}` }}>
              {chart.bars.map((bar) => (
                <div
                  key={bar.hour}
                  title={`${bar.label}:00 · ${formatNaira(bar.total)}`}
                  style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", cursor: "default" }}
                >
                  <div
                    data-hour={bar.label}
                    data-peak={bar.peak || undefined}
                    style={{ width: "100%", height: `${bar.pct}%`, background: bar.peak ? HOUR_BAR.peak : HOUR_BAR.other, borderRadius: "4px 4px 0 0" }}
                  />
                </div>
              ))}
            </div>
            {!peak && (
              <p style={{ position: "absolute", inset: 0, margin: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: COLORS.slateMid }}>
                No billed sales in this period yet.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {chart.bars.map((bar) => (
                <span key={bar.hour} style={{ flex: 1, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10.5, color: COLORS.slateLight }}>
                  {bar.label}
                </span>
              ))}
            </div>
          </div>
          <table style={visuallyHidden}>
            <caption>Billed sales by hour</caption>
            <thead>
              <tr>
                <th scope="col">Hour</th>
                <th scope="col">Sales</th>
              </tr>
            </thead>
            <tbody>
              {chart.bars.map((bar) => (
                <tr key={bar.hour}>
                  <th scope="row">{bar.label}:00</th>
                  <td>{formatNaira(bar.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </DashboardCard>
  );
}

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
