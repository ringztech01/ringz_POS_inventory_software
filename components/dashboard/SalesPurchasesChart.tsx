"use client";

import "./chart-setup";
import { Bar } from "react-chartjs-2";
import { AlignJustify } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import type { WeeklySalesPurchases } from "@/lib/dashboard/queries";

const PURCHASES_COLOR = "#1c62a8";

// Axis ticks: whole Naira with grouping (₦150,000).
const tickLabel = (value: string | number) =>
  `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Number(value))}`;

const SCALES = {
  x: {
    grid: { color: "#f5f7f7" },
    border: { color: COLORS.borderStrong },
    ticks: { font: { size: 11.5 } },
  },
  y: {
    beginAtZero: true,
    suggestedMax: 1,
    title: { display: true, text: "Amount", color: COLORS.slateMid, font: { size: 11.5, weight: 600 as const } },
    grid: { color: "#f5f7f7" },
    border: { color: COLORS.borderStrong },
    ticks: {
      callback: tickLabel,
      font: { family: "'IBM Plex Mono', monospace", size: 11 },
    },
  },
};

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.slate }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

// "This Week Sales & Purchases": the last 7 days (today included), per-day
// Received totals from the server (lib/dashboard/queries.ts). The amounts
// arrive as Decimal strings; bars plot them as numbers, tooltips show the
// exact strings.
export default function SalesPurchasesChart({ week }: { week: WeeklySalesPurchases }) {
  const hover = useToggleState();

  const data = {
    labels: week.labels,
    datasets: [
      { label: "Sales", data: week.sales.map(Number), backgroundColor: COLORS.teal, borderRadius: 4, maxBarThickness: 26 },
      { label: "Purchases", data: week.purchases.map(Number), backgroundColor: PURCHASES_COLOR, borderRadius: 4, maxBarThickness: 26 },
    ],
  };
  const exact = [week.sales, week.purchases];
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item: { dataset: { label?: string }; datasetIndex: number; dataIndex: number }) =>
            `${item.dataset.label}: ${formatNaira(exact[item.datasetIndex][item.dataIndex])}`,
        },
      },
    },
    scales: SCALES,
  };

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "18px 22px",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>This Week Sales &amp; Purchases</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LegendDot color={COLORS.teal} label="Sales" />
            <LegendDot color={PURCHASES_COLOR} label="Purchases" />
          </div>
          <button
            type="button"
            onMouseEnter={hover.on}
            onMouseLeave={hover.off}
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${COLORS.borderStrong}`,
              background: "#fff",
              borderRadius: 8,
              cursor: "pointer",
              color: hover.value ? COLORS.ink : COLORS.slate,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlignJustify size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>
      <div style={{ padding: "20px 22px 22px", height: 340 }}>
        <Bar data={data} options={options} />
      </div>
    </div>
  );
}
