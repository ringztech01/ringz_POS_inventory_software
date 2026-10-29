import { PackageSearch } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import type { TopProduct } from "@/lib/dashboard/queries";
import HoverRow from "./HoverRow";

const GRID_COLUMNS = "minmax(0,1.6fr) 140px 160px";
const HEADERS = [
  { label: "Product", align: "left" as const },
  { label: "Quantity", align: "right" as const },
  { label: "Grand total", align: "right" as const },
];

// "Top Selling Products ({month})": this month's top 5 by quantity
// (lib/dashboard/queries.ts → getTopSellingProductsThisMonth). Grand total is
// the sum of the product's line subtotals.
export default function TopSellingMayCard({ month, rows }: { month: string; rows: TopProduct[] }) {
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
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Top Selling Products ({month})</h3>
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
      {rows.length === 0 ? (
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
          <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>No sales recorded in {month} yet.</span>
        </div>
      ) : (
        rows.map((row) => (
          <HoverRow
            key={row.productId}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              columnGap: 16,
              alignItems: "center",
              padding: "0 22px",
              height: 56,
              borderBottom: `1px solid ${COLORS.bgApp}`,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 600, color: COLORS.ink }}>{row.code}</span>
              <span style={{ fontSize: 14, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</span>
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>{row.quantity}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
              {formatNaira(row.grandTotal)}
            </span>
          </HoverRow>
        ))
      )}
    </div>
  );
}
