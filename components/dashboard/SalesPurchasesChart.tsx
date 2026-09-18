"use client";

import "./chart-setup";
import { Bar } from "react-chartjs-2";
import { AlignJustify } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

const LABELS = ["2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26"];

const DATA = {
  labels: LABELS,
  datasets: [
    { label: "Sales", data: [0, 0, 0, 0, 0, 0, 0], backgroundColor: COLORS.teal, borderRadius: 4, maxBarThickness: 26 },
    { label: "Purchases", data: [0, 0, 0, 0, 0, 0, 0], backgroundColor: "#1c62a8", borderRadius: 4, maxBarThickness: 26 },
  ],
};

const OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
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
        callback: (value: string | number) => `₦${value}`,
        font: { family: "'IBM Plex Mono', monospace", size: 11 },
      },
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

export default function SalesPurchasesChart() {
  const hover = useToggleState();

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
            <LegendDot color="#1c62a8" label="Purchases" />
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
        <Bar data={DATA} options={OPTIONS} />
      </div>
    </div>
  );
}
