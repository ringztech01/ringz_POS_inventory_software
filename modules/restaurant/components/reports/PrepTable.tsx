import { COLORS, FONTS } from "@/components/layout/theme";
import { formatPrepTime } from "../../lib/dashboard";
import { isLateRateHigh, lateRateText } from "../../lib/prepTimes";
import { R } from "../../lib/theme";
import type { PrepGroup } from "../../server/queries/prepTimes";

// One of the prep-time report's tables (By station / By dish): lines, qty,
// average wait / cook / total, the slowest, and the late share — red above
// 20%. Numbers in the mono font.

const time = (seconds: number | null) => (seconds === null ? "—" : formatPrepTime(seconds));

const th = { padding: "10px 12px", fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: COLORS.slateMid, textAlign: "right", whiteSpace: "nowrap" } as const;
const td = { padding: "11px 12px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, fontFamily: FONTS.mono, textAlign: "right", whiteSpace: "nowrap" } as const;

export default function PrepTable({ title, first, rows, empty }: { title: string; first: string; rows: PrepGroup[]; empty: string }) {
  return (
    <section aria-label={title} style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {rows.length === 0 ? (
        <p data-empty style={{ margin: 0, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          {empty}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>{first}</th>
                <th style={th}>Lines</th>
                <th style={th}>Qty</th>
                <th style={th}>Avg wait</th>
                <th style={th}>Avg cook</th>
                <th style={th}>Avg total</th>
                <th style={th}>Max</th>
                <th style={th}>Late %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const high = isLateRateHigh(row.late, row.lines);
                return (
                  <tr key={row.id ?? "none"} data-row={row.name}>
                    <td style={{ ...td, fontFamily: FONTS.body, fontWeight: 600, textAlign: "left" }}>{row.name}</td>
                    <td style={td}>{row.lines}</td>
                    <td style={td}>{row.quantity}</td>
                    <td style={td}>{time(row.avgWait)}</td>
                    <td style={td}>{time(row.avgCook)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{time(row.avgTotal)}</td>
                    <td style={td}>{time(row.maxTotal)}</td>
                    <td data-late={high || undefined} style={{ ...td, color: high ? R.danger : COLORS.slate, fontWeight: high ? 600 : 400 }}>
                      {lateRateText(row.late, row.lines)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
