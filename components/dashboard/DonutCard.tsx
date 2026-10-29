"use client";

import "./chart-setup";
import type { ReactNode } from "react";
import { Doughnut } from "react-chartjs-2";
import { COLORS } from "@/components/layout/theme";

// Slice colours, in order (the design's teal first, then the tile palette).
export const DONUT_COLORS = [COLORS.teal, "#1c62a8", "#a76a09", "#073b33", "#86cbc0"];

export type DonutSlice = {
  label: string;
  // What the slice's size is (quantity, amount…) — as a number for drawing.
  value: number;
  // Shown in the tooltip, e.g. "7 sold" or "₦560,000.00".
  detail?: string;
};

type DonutCardProps = {
  title: string;
  headerExtra?: ReactNode;
  slices: DonutSlice[];
};

// A doughnut card (RingzPOS Dashboard design): each slice's share of the
// total. With no data it draws the design's single grey "No sales" disc,
// without a tooltip.
export default function DonutCard({ title, headerExtra, slices }: DonutCardProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const empty = slices.length === 0 || total <= 0;
  const labels = empty ? ["No sales"] : slices.map((slice) => slice.label);
  const data = empty ? [1] : slices.map((slice) => slice.value);
  const colors = empty ? [COLORS.border] : slices.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]);

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
              tooltip: empty
                ? { enabled: false }
                : {
                    backgroundColor: "#171b1c",
                    displayColors: false,
                    callbacks: {
                      label: (item) => {
                        const slice = slices[item.dataIndex];
                        const share = Math.round((slice.value / total) * 1000) / 10;
                        return [slice.label, slice.detail, `${share}%`].filter(Boolean).join(" · ");
                      },
                    },
                  },
            },
          }}
        />
      </div>
    </div>
  );
}
