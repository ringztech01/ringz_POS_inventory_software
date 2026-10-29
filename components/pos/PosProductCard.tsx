"use client";

import { Package } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import type { PosProduct } from "@/app/(pos)/pos/types";
import { POS } from "./theme";

const badge = {
  fontFamily: FONTS.mono,
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  padding: "4px 9px",
  borderRadius: 7,
} as const;

// A grid card: image, price (top left), the warehouse's stock (top right),
// name and code.
export default function PosProductCard({ product, onSelect }: { product: PosProduct; onSelect: () => void }) {
  const hover = useToggleState();
  const outOfStock = product.stock <= 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      title={outOfStock ? "Out of stock in this warehouse" : product.name}
      style={{
        display: "flex",
        flexDirection: "column",
        padding: 0,
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        boxShadow: hover.value ? "0 8px 20px -8px rgba(90,99,234,.4)" : "0 2px 8px -4px rgba(23,27,28,.12)",
        transform: hover.value ? "translateY(-2px)" : "none",
        transition: "box-shadow .14s, transform .14s",
      }}
    >
      <span style={{ position: "relative", width: "100%", height: 150, background: POS.searchBg, display: "block" }}>
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.slateLight,
              backgroundImage: `repeating-linear-gradient(135deg, ${COLORS.border} 0 8px, transparent 8px 16px)`,
            }}
          >
            <Package size={28} strokeWidth={1.4} />
          </span>
        )}
        {/* Price top-left, stock top-right; a long pair wraps instead of overlapping. */}
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            right: 8,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 4,
            pointerEvents: "none",
          }}
        >
          <span style={{ ...badge, background: POS.indigo }}>{formatNaira(product.price)}</span>
          <span style={{ ...badge, marginLeft: "auto", background: outOfStock ? POS.remove : POS.sky }}>
            {product.stock.toLocaleString("en-NG")} {product.unitName}
          </span>
        </span>
      </span>
      <span style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink, lineHeight: 1.3, minHeight: 39 }}>{product.name}</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slateLight }}>{product.code}</span>
      </span>
    </button>
  );
}
