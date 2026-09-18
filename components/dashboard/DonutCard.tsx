"use client";

import "./chart-setup";
import type { ReactNode } from "react";
import { Doughnut } from "react-chartjs-2";
import { COLORS } from "@/components/layout/theme";

type DonutCardProps = {
  title: string;
  headerExtra?: ReactNode;
  labels: string[];
  data: number[];
  colors: string[];
  showTooltip?: boolean;
};

export default function DonutCard({ title, headerExtra, labels, data, colors, showTooltip }: DonutCardProps) {
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
          padding: "18px 22px",
          borderBottom: `1px solid ${COLORS.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
        {headerExtra}
      </div>
      <div style={{ padding: 22, height: 340, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Doughnut
          data={{ labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: "0%",
            plugins: {
              legend: { display: false },
              tooltip: showTooltip
                ? { backgroundColor: "#171b1c", displayColors: false, callbacks: { label: () => `${labels[0]} · 100%` } }
                : { enabled: false },
            },
          }}
        />
      </div>
    </div>
  );
}
