import { Package } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";
import ProductRowMenu from "./ProductRowMenu";
import { formatDateTime, formatNaira } from "@/lib/format";
import type { ProductListRow } from "@/app/(dashboard)/products/queries";

const GRID_COLUMNS = "40px 76px minmax(180px,1.4fr) 110px 90px 130px 120px 100px 150px 40px";
const HEADERS = ["Product", "Name", "Code", "Brand", "Price", "Product unit", "In stock", "Created on", "Action"];

function Checkbox() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        border: "1.5px solid #c3cacc",
        background: "#fff",
      }}
    />
  );
}

function Thumb({ src }: { src: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
    );
  }

  return (
    <span
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.bgInput,
        backgroundImage: `repeating-linear-gradient(135deg, ${COLORS.border} 0 6px, transparent 6px 12px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.slateLight,
      }}
    >
      <Package size={16} strokeWidth={1.8} />
    </span>
  );
}

function firstImage(images: unknown): string | null {
  if (Array.isArray(images) && typeof images[0] === "string") return images[0];
  return null;
}

function stockTone(quantity: number): { bg: string; fg: string } {
  if (quantity === 0) return { bg: "#fce8e6", fg: "#93201a" };
  if (quantity <= 10) return { bg: "#fdf1d8", fg: "#7d5106" };
  return { bg: "#e2f4ec", fg: "#0b6146" };
}

export default function ProductTable({ products }: { products: ProductListRow[] }) {
  if (products.length === 0) {
    return <EmptyState icon={Package} message="No products found." />;
  }

  return (
    <div style={{ overflowX: "auto", paddingBottom: 180, marginBottom: -180 }}>
      <div style={{ minWidth: 1160 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            columnGap: 16,
            alignItems: "center",
            padding: "0 20px",
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <Checkbox />
          {HEADERS.map((label) => (
            <span
              key={label}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: COLORS.slateMid,
                textAlign: label === "Price" || label === "In stock" || label === "Action" ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {products.map((product) => {
          const { time, date } = formatDateTime(product.createdAt);
          const tone = stockTone(product.stock);

          return (
            <div
              key={product.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: 68,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                whiteSpace: "nowrap",
                position: "relative",
              }}
            >
              <Checkbox />
              <Thumb src={firstImage(product.images)} />
              <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                {product.name}
              </span>
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  fontWeight: 500,
                  background: COLORS.bgApp,
                  border: `1px solid ${COLORS.borderStrong}`,
                  color: COLORS.text,
                  padding: "4px 9px",
                  borderRadius: 6,
                  justifySelf: "start",
                }}
              >
                {product.code}
              </span>
              <span style={{ fontSize: 14, color: COLORS.slate }}>{product.brand.name}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                {formatNaira(product.price)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  background: COLORS.border,
                  color: COLORS.slate,
                  padding: "4px 9px",
                  borderRadius: 6,
                  justifySelf: "start",
                }}
              >
                {product.unit.name}
              </span>
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "right",
                  justifySelf: "end",
                  padding: "4px 9px",
                  borderRadius: 6,
                  background: tone.bg,
                  color: tone.fg,
                }}
              >
                {product.stock}
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{date}</span>
                <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{time}</span>
              </span>
              <ProductRowMenu id={product.id} name={product.name} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
