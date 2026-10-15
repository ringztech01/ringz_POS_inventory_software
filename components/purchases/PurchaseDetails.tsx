import type { ReactNode } from "react";
import { ArrowLeft, Building2, Mail, MapPin, Smartphone, User, type LucideIcon } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import { COMPANY } from "@/lib/company";
import { formatDateOnly, formatNaira } from "@/lib/format";
import type { PurchaseDocument } from "@/app/(dashboard)/purchases/queries";
import DownloadPdfButton from "./DownloadPdfButton";
import { PaymentTypePill, PurchaseStatusPill } from "./purchase-display";

const SUMMARY_GRID = "minmax(220px,1.4fr) 150px 110px 140px 130px 130px 150px";
const SUMMARY_HEADERS = ["Product", "Net unit cost", "Quantity", "Unit cost", "Discount", "Tax", "Subtotal"];

const STATUS_PHRASE = {
  RECEIVED: "received into",
  ORDERED: "ordered for",
  PENDING: "pending for",
} as const;

const overline = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", background: COLORS.bgInput, borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={overline}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function ContactLine({
  icon: Icon,
  strong,
  mono,
  wrap,
  children,
}: {
  icon: LucideIcon;
  strong?: boolean;
  mono?: boolean;
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: wrap ? "flex-start" : "center",
        gap: 10,
        fontSize: strong ? 14 : 13.5,
        fontWeight: strong ? 600 : 400,
        color: strong ? COLORS.ink : COLORS.slate,
        lineHeight: wrap ? 1.5 : undefined,
        overflowWrap: "anywhere",
      }}
    >
      <span style={{ color: COLORS.teal, display: "flex", paddingTop: wrap ? 2 : 0, flex: "0 0 auto" }}>
        <Icon size={15} strokeWidth={1.7} />
      </span>
      {mono ? <span style={{ fontFamily: FONTS.mono, fontSize: 13 }}>{children}</span> : children}
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, width: 86, flex: "0 0 auto" }}>{label}</span>
      {children}
    </span>
  );
}

function TotalsRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: last ? "16px 18px" : "14px 18px",
        borderBottom: last ? "none" : `1px solid ${COLORS.border}`,
        background: last ? COLORS.tealTint : "transparent",
      }}
    >
      <span
        style={{ fontSize: last ? 14 : 13.5, fontWeight: last ? 600 : 400, color: last ? COLORS.tealDark : COLORS.slate }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: last ? 15 : 13,
          fontWeight: last ? 600 : 400,
          color: last ? COLORS.tealDark : COLORS.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Read-only purchase document — "Purchase Details" in the RingzPOS design.
export default function PurchaseDetails({ purchase }: { purchase: PurchaseDocument }) {
  const money = { fontFamily: FONTS.mono, fontSize: 13, textAlign: "right" as const };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-.015em",
            }}
          >
            Purchase Details
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Reference {purchase.reference} · {STATUS_PHRASE[purchase.status]} {purchase.warehouse.name}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <DownloadPdfButton href={`/purchases/${purchase.id}/pdf`} />
          <GhostButton href="/purchases" paddingX={18}>
            <ArrowLeft size={14} strokeWidth={1.7} />
            Back
          </GhostButton>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingBottom: 4 }}>
          <span style={overline}>Purchase details</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, letterSpacing: "-.015em" }}>
            {purchase.reference}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 24 }}>
          <InfoCard title="Supplier info">
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <ContactLine icon={User} strong>
                {purchase.supplier.name}
              </ContactLine>
              <ContactLine icon={Mail}>{purchase.supplier.email}</ContactLine>
              <ContactLine icon={Smartphone} mono>
                {purchase.supplier.phoneNumber}
              </ContactLine>
              <ContactLine icon={MapPin} wrap>
                {purchase.supplier.address}
              </ContactLine>
            </div>
          </InfoCard>

          <InfoCard title="Company info">
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <ContactLine icon={Building2} strong>
                {COMPANY.name}
              </ContactLine>
              <ContactLine icon={Mail}>{COMPANY.email}</ContactLine>
              <ContactLine icon={Smartphone} mono>
                {COMPANY.phone}
              </ContactLine>
              <ContactLine icon={MapPin} wrap>
                {COMPANY.address}
              </ContactLine>
            </div>
          </InfoCard>

          <InfoCard title="Purchase info">
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <InfoRow label="Reference">
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
                  }}
                >
                  {purchase.reference}
                </span>
              </InfoRow>
              <InfoRow label="Date">
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>
                  {formatDateOnly(purchase.date)}
                </span>
              </InfoRow>
              <InfoRow label="Status">
                <PurchaseStatusPill status={purchase.status} />
              </InfoRow>
              <InfoRow label="Warehouse">
                <span style={{ fontSize: 13.5, color: COLORS.slate }}>{purchase.warehouse.name}</span>
              </InfoRow>
              <InfoRow label="Payment">
                <PaymentTypePill paymentType={purchase.paymentType} />
              </InfoRow>
            </div>
          </InfoCard>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={overline}>Order summary</span>
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 1000 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: SUMMARY_GRID,
                    columnGap: 16,
                    alignItems: "center",
                    padding: "0 20px",
                    height: 44,
                    background: COLORS.bgInput,
                    borderBottom: `1px solid ${COLORS.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {SUMMARY_HEADERS.map((label, index) => (
                    <span key={label} style={{ ...overline, textAlign: index === 0 ? "left" : "right" }}>
                      {label}
                    </span>
                  ))}
                </div>
                {purchase.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: SUMMARY_GRID,
                      columnGap: 16,
                      alignItems: "center",
                      padding: "0 20px",
                      height: 60,
                      borderBottom: `1px solid ${COLORS.bgApp}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, color: COLORS.ink }}>
                        {item.code}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#e2f4ec",
                          color: "#0b6146",
                          padding: "4px 9px",
                          borderRadius: 6,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.name}
                      </span>
                    </span>
                    <span style={{ ...money, fontWeight: 600 }}>{formatNaira(item.netUnitCost)}</span>
                    <span style={{ ...money, color: COLORS.text }}>
                      {item.quantity} {item.purchaseUnit}
                    </span>
                    <span style={{ ...money, color: COLORS.slate }}>{formatNaira(item.unitCost)}</span>
                    <span style={{ ...money, color: COLORS.slate }}>{formatNaira(item.discount)}</span>
                    <span style={{ ...money, color: COLORS.slate }}>{formatNaira(item.tax)}</span>
                    <span style={{ ...money, fontWeight: 600 }}>{formatNaira(item.subtotal)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 420, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            <TotalsRow
              label="Order Tax"
              value={`${formatNaira(purchase.orderTaxAmount)} (${purchase.orderTaxRate}%)`}
            />
            <TotalsRow label="Discount" value={formatNaira(purchase.discount)} />
            <TotalsRow label="Shipping" value={formatNaira(purchase.shipping)} />
            <TotalsRow label="Grand Total" value={formatNaira(purchase.grandTotal)} last />
          </div>
        </div>
      </div>
    </div>
  );
}
