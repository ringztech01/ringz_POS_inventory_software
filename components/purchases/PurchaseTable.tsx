import { ShoppingCart } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";
import PurchaseRowMenu from "./PurchaseRowMenu";
import { PaymentTypePill, PurchaseStatusPill } from "./purchase-display";
import { formatDateTime, formatNaira } from "@/lib/format";
import type { PurchaseListRow } from "@/app/(dashboard)/purchases/queries";

const GRID_COLUMNS = "130px minmax(150px,1fr) 120px 130px 150px 130px 150px 40px";
const HEADERS = ["Reference", "Supplier", "Warehouse", "Status", "Grand total", "Payment type", "Created on", "Action"];
const RIGHT_ALIGNED = new Set(["Grand total", "Action"]);

const rowBase = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  columnGap: 16,
  alignItems: "center",
  padding: "0 20px",
  whiteSpace: "nowrap",
} as const;

export default function PurchaseTable({
  purchases,
  grandTotalSum,
}: {
  purchases: PurchaseListRow[];
  grandTotalSum: string;
}) {
  if (purchases.length === 0) {
    return <EmptyState icon={ShoppingCart} message="No purchases found." />;
  }

  return (
    // The padding/negative-margin pair gives the row menus room to open below
    // the last rows without being clipped by the horizontal scroll container.
    <div style={{ overflowX: "auto", paddingBottom: 200, marginBottom: -200 }}>
      <div style={{ minWidth: 1160 }}>
        <div
          style={{
            ...rowBase,
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
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
                textAlign: RIGHT_ALIGNED.has(label) ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {purchases.map((purchase) => {
          const createdOn = formatDateTime(purchase.createdAt);

          return (
            <div
              key={purchase.id}
              style={{
                ...rowBase,
                height: 60,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                position: "relative",
              }}
            >
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
                {purchase.reference}
              </span>
              <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                {purchase.supplier.name}
              </span>
              <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                {purchase.warehouse.name}
              </span>
              <PurchaseStatusPill status={purchase.status} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
                {formatNaira(purchase.grandTotal)}
              </span>
              <PaymentTypePill paymentType={purchase.paymentType} />
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{createdOn.date}</span>
                <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{createdOn.time}</span>
              </span>
              <PurchaseRowMenu
                id={purchase.id}
                reference={purchase.reference}
                status={purchase.status}
                warehouseName={purchase.warehouse.name}
              />
            </div>
          );
        })}

        <div
          style={{
            ...rowBase,
            height: 56,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink }}>Total</span>
          <span />
          <span />
          <span />
          <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
            {formatNaira(grandTotalSum)}
          </span>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
