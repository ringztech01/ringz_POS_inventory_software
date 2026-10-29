import { ArrowLeft, ArrowRight, ShoppingCart, ShoppingCartPlus, type LucideIcon } from "lucide-react";
import { FONTS } from "@/components/layout/theme";
import type { WarehouseReportCounts } from "@/lib/reports/queries";

// The design's 4 stat cards (RingzPOS Reports.dc.html → STAT_CARDS).
const TILES: { key: keyof WarehouseReportCounts; label: string; bg: string; shadow: string; Icon: LucideIcon }[] = [
  { key: "sales", label: "Sales", bg: "#7b74ff", shadow: "rgba(123,116,255,.5)", Icon: ShoppingCart },
  { key: "purchases", label: "Purchases", bg: "#22b07d", shadow: "rgba(34,176,125,.5)", Icon: ShoppingCartPlus },
  { key: "saleReturns", label: "Sales Return", bg: "#2aa6e8", shadow: "rgba(42,166,232,.5)", Icon: ArrowRight },
  { key: "purchaseReturns", label: "Purchases Return", bg: "#f2b134", shadow: "rgba(242,177,52,.5)", Icon: ArrowLeft },
];

// Document counts for the selected warehouse (whole numbers, not money).
export default function ReportCountTiles({ counts }: { counts: WarehouseReportCounts }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
      {TILES.map(({ key, label, bg, shadow, Icon }) => (
        <div
          key={key}
          style={{
            borderRadius: 14,
            background: bg,
            padding: "26px 24px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            boxShadow: `0 6px 16px -6px ${shadow}`,
          }}
        >
          <span
            style={{
              width: 56,
              height: 56,
              flex: "0 0 auto",
              borderRadius: 12,
              background: "rgba(255,255,255,.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <Icon size={26} strokeWidth={1.5} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, color: "#fff" }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
              {counts[key].toLocaleString("en-NG")}
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.92 }}>{label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
