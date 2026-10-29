import type { CSSProperties } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import HoverRow from "./HoverRow";
import { COLORS, FONTS } from "@/components/layout/theme";
import type { StockAlertRow } from "@/lib/dashboard/queries";

const GRID_COLUMNS = "120px minmax(200px,1.4fr) 160px 180px 180px";
const HEADERS = ["Code", "Product", "Warehouse", "Quantity", "Alert quantity"];

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
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

// "Stock Alert": one row per product × warehouse at or below the product's
// alert level, lowest stock first (lib/dashboard/queries.ts →
// getStockAlerts). `total` is the full count; when there are more rows than
// shown, "View all" reloads the dashboard with ?stock=all.
export default function StockAlertCard({
  rows,
  total,
  showingAll,
}: {
  rows: StockAlertRow[];
  total: number;
  showingAll: boolean;
}) {
  const none = total === 0;

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
            // Red while anything is low; the design's green pill when nothing is.
            background: none ? "#e2f4ec" : "#fce8e6",
            color: none ? "#0b6146" : "#93201a",
          }}
        >
          {total} {total === 1 ? "item" : "items"} below alert
        </span>
      </div>

      {none ? (
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
            <PackageCheck size={19} strokeWidth={1.6} />
          </span>
          <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>All stock above alert levels.</span>
        </div>
      ) : (
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

            {rows.map((row, i) => {
              const unit = row.unitName.toLowerCase();
              return (
                <HoverRow
                  key={`${row.productId}:${row.warehouseId}`}
                  style={{ ...rowStyle, borderBottom: i < rows.length - 1 ? "1px solid #f5f7f7" : "none" }}
                >
                  <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 500, color: COLORS.text }}>{row.code}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</span>
                  <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.warehouseName}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
                    {/* Design: red when out of stock, amber when some is left. */}
                    <Chip
                      label={String(row.quantity)}
                      bg={row.quantity <= 0 ? "#fce8e6" : "#fdf1d8"}
                      color={row.quantity <= 0 ? "#93201a" : "#7d5106"}
                    />
                    <UnitChip label={unit} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start" }}>
                    <Chip label={String(row.stockAlert)} bg="#fce8e6" color="#93201a" />
                    <UnitChip label={unit} />
                  </span>
                </HoverRow>
              );
            })}
          </div>
        </div>
      )}

      {(total > rows.length || showingAll) && total > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "14px 22px",
            borderTop: `1px solid ${COLORS.border}`,
            fontSize: 13,
            color: COLORS.slateMid,
          }}
        >
          <span>
            Showing {rows.length} of {total}
          </span>
          <Link
            href={showingAll ? "/dashboard" : "/dashboard?stock=all"}
            scroll={false}
            style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal }}
          >
            {showingAll ? "Show fewer" : "View all"}
          </Link>
        </div>
      )}
    </div>
  );
}
