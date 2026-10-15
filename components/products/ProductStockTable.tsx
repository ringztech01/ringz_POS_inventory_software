import { COLORS, FONTS } from "@/components/layout/theme";
import type { StockBreakdownRow } from "@/app/(dashboard)/products/types";

export default function ProductStockTable({ breakdown }: { breakdown: StockBreakdownRow[] }) {
  const total = breakdown.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 16, fontWeight: 600 }}>Stock by warehouse</h3>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px",
            padding: "10px 16px",
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
            }}
          >
            Warehouse
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: COLORS.slateMid,
              textAlign: "right",
            }}
          >
            Quantity
          </span>
        </div>

        {breakdown.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13.5, color: COLORS.slateMid }}>No stock recorded yet.</div>
        ) : (
          breakdown.map((row) => (
            <div
              key={row.warehouseId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px",
                padding: "10px 16px",
                borderBottom: `1px solid ${COLORS.bgApp}`,
              }}
            >
              <span style={{ fontSize: 13.5 }}>{row.warehouseName}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                {row.quantity}
              </span>
            </div>
          ))
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", padding: "10px 16px", background: COLORS.bgInput }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Total</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, textAlign: "right" }}>{total}</span>
        </div>
      </div>
    </div>
  );
}
