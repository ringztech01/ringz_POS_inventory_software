import { COLORS, FONTS } from "@/components/layout/theme";

const GRID_COLUMNS = "minmax(200px,1.4fr) 160px 120px 140px";

type AdjustmentItemRow = {
  id: string;
  quantity: number;
  type: "ADDITION" | "SUBTRACTION";
  product: { id: string; name: string; code: string };
};

const headerCellStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase" as const,
  color: COLORS.slateMid,
};

export default function AdjustmentItemsTable({ items }: { items: AdjustmentItemRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 16, fontWeight: 600 }}>Items</h3>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            columnGap: 16,
            padding: "10px 16px",
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <span style={headerCellStyle}>Product</span>
          <span style={headerCellStyle}>Code</span>
          <span style={{ ...headerCellStyle, textAlign: "right" }}>Qty</span>
          <span style={headerCellStyle}>Type</span>
        </div>

        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              columnGap: 16,
              padding: "12px 16px",
              alignItems: "center",
              borderBottom: `1px solid ${COLORS.bgApp}`,
            }}
          >
            <span style={{ fontSize: 14 }}>{item.product.name}</span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 12,
                background: COLORS.bgApp,
                border: `1px solid ${COLORS.borderStrong}`,
                padding: "4px 9px",
                borderRadius: 6,
                justifySelf: "start",
              }}
            >
              {item.product.code}
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
              {item.quantity}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: item.type === "ADDITION" ? COLORS.tealDark : COLORS.danger,
              }}
            >
              {item.type === "ADDITION" ? "Addition" : "Subtraction"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
