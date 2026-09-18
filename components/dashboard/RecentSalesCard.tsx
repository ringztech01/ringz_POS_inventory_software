"use client";

import HoverRow from "./HoverRow";
import { COLORS, FONTS } from "@/components/layout/theme";

const RECENT = [
  { ref: "SA_11149", customer: "direct-customer", total: "₦71800.00", paid: "₦71800.00" },
  { ref: "SA_11148", customer: "direct-customer", total: "₦31920.00", paid: "₦31920.00" },
  { ref: "SA_11147", customer: "direct-customer", total: "₦7980.00", paid: "₦7980.00" },
  { ref: "SA_11146", customer: "direct-customer", total: "₦11970.00", paid: "₦11970.00" },
  { ref: "SA_11145", customer: "direct-customer", total: "₦7980.00", paid: "₦7980.00" },
];

const GRID_COLUMNS = "130px minmax(160px,1.2fr) 130px 150px 150px 130px 140px";

const HEADERS = [
  { label: "Reference", align: "left" as const },
  { label: "Customer", align: "left" as const },
  { label: "Status", align: "left" as const },
  { label: "Grand total", align: "right" as const },
  { label: "Paid", align: "right" as const },
  { label: "Due", align: "right" as const },
  { label: "Payment status", align: "left" as const },
];

function Pill({ label, dot, bg, color }: { label: string; dot: string; bg: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        padding: "5px 11px",
        borderRadius: 999,
        justifySelf: "start",
        background: bg,
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      {label}
    </span>
  );
}

export default function RecentSalesCard() {
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
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recent Sales</h3>
        <a href="#recent-sales" style={{ fontSize: 13, fontWeight: 600 }}>
          View all sales
        </a>
      </div>
      <div style={{ overflowX: "auto", paddingBottom: 20, marginBottom: -20 }}>
        <div style={{ minWidth: 1040 }}>
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
            {HEADERS.map(({ label, align }) => (
              <span
                key={label}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: COLORS.slateMid,
                  textAlign: align,
                }}
              >
                {label}
              </span>
            ))}
          </div>
          {RECENT.map((row) => (
            <HoverRow
              key={row.ref}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                columnGap: 16,
                alignItems: "center",
                padding: "0 22px",
                height: 56,
                borderBottom: "1px solid #f5f7f7",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 500, color: COLORS.text }}>{row.ref}</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{row.customer}</span>
              <Pill label="Received" dot="#10805c" bg="#e2f4ec" color="#0b6146" />
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>{row.total}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>{row.paid}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>₦0.00</span>
              <Pill label="Paid" dot="#10805c" bg="#e2f4ec" color="#0b6146" />
            </HoverRow>
          ))}
        </div>
      </div>
    </div>
  );
}
