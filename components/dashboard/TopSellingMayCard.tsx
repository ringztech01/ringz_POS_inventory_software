import { PackageSearch } from "lucide-react";
import { COLORS } from "@/components/layout/theme";

const GRID_COLUMNS = "minmax(0,1.6fr) 140px 160px";
const HEADERS = [
  { label: "Product", align: "left" as const },
  { label: "Quantity", align: "right" as const },
  { label: "Grand total", align: "right" as const },
];

export default function TopSellingMayCard() {
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
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${COLORS.border}` }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Top Selling Products (May)</h3>
      </div>
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
      <div style={{ padding: "44px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: COLORS.bgApp,
            color: COLORS.slateLight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PackageSearch size={19} strokeWidth={1.6} />
        </span>
        <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>No sales recorded in May yet.</span>
      </div>
    </div>
  );
}
