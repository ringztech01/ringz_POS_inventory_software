"use client";

import type { CSSProperties } from "react";
import HoverRow from "./HoverRow";
import { COLORS, FONTS } from "@/components/layout/theme";

const GRID_COLUMNS = "120px minmax(200px,1.4fr) 160px 180px 180px";
const HEADERS = ["Code", "Product", "Warehouse", "Quantity", "Alert quantity"];

function Chip({ label, bg, color, border }: { label: string; bg: string; color: string; border?: string }) {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 12,
        fontWeight: 600,
        background: bg,
        color,
        padding: "4px 9px",
        borderRadius: 6,
        border,
      }}
    >
      {label}
    </span>
  );
}

function UnitChip({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 500, background: "#eceff0", color: COLORS.slate, padding: "4px 9px", borderRadius: 6 }}>
      {label}
    </span>
  );
}

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  columnGap: 16,
  alignItems: "center",
  padding: "0 22px",
  height: 56,
  whiteSpace: "nowrap",
};

export default function StockAlertCard() {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        overflow: "hidden",
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
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Stock Alert</h3>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 11px",
            borderRadius: 999,
            background: "#fce8e6",
            color: "#93201a",
          }}
        >
          2 items below alert
        </span>
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 20, marginBottom: -20 }}>
        <div style={{ minWidth: 960 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              columnGap: 16,
              alignItems: "center",
              padding: "0 22px",
              height: 44,
              background: COLORS.bgInput,
              borderBottom: `1px solid ${COLORS.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {HEADERS.map((label) => (
              <span
                key={label}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: COLORS.slateMid,
                }}
              >
                {label}
              </span>
            ))}
          </div>

          <HoverRow style={{ ...rowStyle, borderBottom: "1px solid #f5f7f7" }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 500, color: COLORS.text }}>002</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>ipl laser hair removal</span>
            <span style={{ fontSize: 14, color: COLORS.slate }}>Office</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
              <Chip label="0" bg="#fce8e6" color="#93201a" />
              <UnitChip label="piece" />
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
              <Chip label="—" bg="#f5f7f7" color={COLORS.text} border={`1px solid ${COLORS.borderStrong}`} />
              <UnitChip label="piece" />
            </span>
          </HoverRow>

          <HoverRow style={rowStyle}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 500, color: COLORS.text }}>001</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>FACE FAT AND DOUBLE CHIN</span>
            <span style={{ fontSize: 14, color: COLORS.slate }}>Office</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
              <Chip label="2" bg="#fdf1d8" color="#7d5106" />
              <UnitChip label="piece" />
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
              <Chip label="3" bg="#fce8e6" color="#93201a" />
              <UnitChip label="piece" />
            </span>
          </HoverRow>
        </div>
      </div>
    </div>
  );
}
