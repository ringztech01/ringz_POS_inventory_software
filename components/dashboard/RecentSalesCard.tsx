import Link from "next/link";
import { Receipt } from "lucide-react";
import HoverRow from "./HoverRow";
import { COLORS, FONTS } from "@/components/layout/theme";
import { PaymentStatusPill, PurchaseStatusPill } from "@/components/purchases/purchase-display";
import { formatNaira } from "@/lib/format";
import type { RecentSale } from "@/lib/dashboard/queries";

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

// "Recent Sales": the 5 most recent live sales of any status
// (lib/dashboard/queries.ts → getRecentSales). Paid / due / payment status
// are the sale's stored values — the same the Sales list shows — and the
// pills are the Sales list's own.
export default function RecentSalesCard({ rows }: { rows: RecentSale[] }) {
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
        <Link href="/sales" style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal }}>
          View all sales
        </Link>
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
                <Receipt size={19} strokeWidth={1.6} />
              </span>
              <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>No sales recorded yet.</span>
            </div>
          ) : (
            rows.map((row) => (
              <HoverRow
                key={row.id}
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
                <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 500, color: COLORS.text }}>{row.reference}</span>
                <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{row.customerName}</span>
                <PurchaseStatusPill status={row.status} />
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", fontWeight: 600 }}>
                  {formatNaira(row.grandTotal)}
                </span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>
                  {formatNaira(row.paid)}
                </span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, textAlign: "right", color: COLORS.slate }}>
                  {formatNaira(row.due)}
                </span>
                <PaymentStatusPill paymentStatus={row.paymentStatus} />
              </HoverRow>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
