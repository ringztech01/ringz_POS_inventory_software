"use client";

import "@/components/dashboard/chart-setup";
import { Chart as ChartJS, Filler, LineElement, PointElement } from "chart.js";
import { Line } from "react-chartjs-2";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";

ChartJS.register(LineElement, PointElement, Filler);

const tick = (value: string | number) => `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0, notation: Number(value) >= 1_000_000 ? "compact" : "standard" }).format(Number(value))}`;

// Restaurant Reports › Overview: net sales by business day. The amounts
// arrive as Decimal strings; the line plots them as numbers, the tooltip
// shows the exact amount.
export default function SalesByDayChart({ days, caption = "Net sales by day", color = COLORS.teal, fill = "rgba(15,125,106,.10)" }: { days: { day: string; label: string; total: string }[]; caption?: string; color?: string; fill?: string }) {
  return (
    <div style={{ height: 220, position: "relative" }} data-sales-by-day={days.length}>
      <Line
        data={{
          labels: days.map((d) => d.label),
          datasets: [
            {
              data: days.map((d) => Number(d.total)),
              borderColor: color,
              backgroundColor: fill,
              fill: true,
              tension: 0.3,
              // Smooth without dipping below 0 between a quiet day and a busy one.
              cubicInterpolationMode: "monotone",
              pointRadius: days.length > 31 ? 0 : 3,
              pointHoverRadius: 5,
              pointBackgroundColor: color,
              borderWidth: 2,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: "#171b1c", displayColors: false, callbacks: { label: (item) => formatNaira(days[item.dataIndex].total) } },
          },
          scales: {
            x: { grid: { display: false }, border: { color: COLORS.borderStrong }, ticks: { font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { beginAtZero: true, suggestedMax: 1, grid: { color: "#f5f7f7" }, border: { color: COLORS.borderStrong }, ticks: { callback: tick, font: { family: "'IBM Plex Mono', monospace", size: 11 } } },
          },
        }}
      />
      <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        <caption>{caption}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.label}</th>
              <td>{formatNaira(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
