import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Mail, MapPin, Smartphone, User, Warehouse, type LucideIcon } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import { COMPANY } from "@/lib/company";
import { formatDateOnly, formatNaira } from "@/lib/format";
import type { PurchaseDocument } from "@/app/(dashboard)/purchases/queries";
import DownloadPdfButton from "./DownloadPdfButton";
import {
  PaymentStatusPill,
  PaymentTypePill,
  PurchaseStatusPill,
  type PurchaseDocumentCopy,
} from "./purchase-display";

const PAYMENTS_GRID = "120px 140px minmax(0,1fr) 140px";
const SUMMARY_GRID = "minmax(220px,1.4fr) 150px 110px 140px 130px 130px 150px";


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

function InfoRow({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, width, flex: "0 0 auto" }}>{label}</span>
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

// Read-only document page — "Purchase Details" in the RingzPOS design, reused
// for Purchase Returns, Sales and Sale Returns via `copy`. Purchase Returns
// show Paid/Due rows in the info card; documents that carry `payments` (Sales,
// and Sale Returns' refunds) get a payment summary instead. `actions` are
// extra header buttons (e.g. Record refund).
export default function PurchaseDetails({
  purchase,
  copy,
  actions,
  subtitle,
}: {
  purchase: PurchaseDocument;
  copy: PurchaseDocumentCopy;
  actions?: ReactNode;
  // Replaces "Reference … · <warehouse>" (Transfers: "From → To").
  subtitle?: string;
}) {
  const money = { fontFamily: FONTS.mono, fontSize: 13, textAlign: "right" as const };
  const summaryHeaders = [
    "Product",
    `Net unit ${copy.priceWord}`,
    copy.qtyLabel,
    copy.unitColumn ? "Unit" : `Unit ${copy.priceWord}`,
    "Discount",
    "Tax",
    "Subtotal",
  ];
  // Party + company cards, or the document's own cards (Transfers: From/To
  // warehouses).
  const cards: { title: string; icon: LucideIcon; name: string; email: string; phoneNumber: string; address: string }[] =
    purchase.contactCards?.map((card) => ({ ...card, icon: Warehouse })) ?? [
      { title: copy.partyTitle, icon: User, ...purchase.party },
      {
        title: "Company info",
        icon: Building2,
        name: COMPANY.name,
        email: COMPANY.email,
        phoneNumber: COMPANY.phone,
        address: COMPANY.address,
      },
    ];
  // Sales show paid/due in their own payment summary instead of the info card.
  const hasPaymentSummary = purchase.payments !== undefined;
  const word = copy.refunds ? "Refund" : "Payment";

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
            {copy.title}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Reference {purchase.reference} ·{" "}
            {subtitle ??
              (copy.statusPhrase
                ? `${copy.statusPhrase[purchase.status]} ${purchase.warehouse.name}`
                : `${purchase.warehouse.name} warehouse`)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {actions}
          {!copy.noPdf && <DownloadPdfButton href={`${copy.basePath}/${purchase.id}/pdf`} />}
          <GhostButton href={copy.basePath} paddingX={18}>
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
          <span style={overline}>{copy.overline}</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, letterSpacing: "-.015em" }}>
            {purchase.reference}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 24 }}>
          {cards.map((card) => (
            <InfoCard key={card.title} title={card.title}>
              <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <ContactLine icon={card.icon} strong>
                  {card.name}
                </ContactLine>
                <ContactLine icon={Mail}>{card.email}</ContactLine>
                <ContactLine icon={Smartphone} mono>
                  {card.phoneNumber}
                </ContactLine>
                <ContactLine icon={MapPin} wrap>
                  {card.address}
                </ContactLine>
              </div>
            </InfoCard>
          ))}

          <InfoCard title={copy.infoTitle}>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <InfoRow label="Reference" width={copy.infoLabelWidth}>
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
              {purchase.source && (
                <InfoRow label={purchase.source.label} width={copy.infoLabelWidth}>
                  {purchase.source.href ? (
                    <Link
                      href={purchase.source.href}
                      style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 500, color: COLORS.teal, textDecoration: "none" }}
                    >
                      {purchase.source.reference}
                    </Link>
                  ) : (
                    <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>
                      {purchase.source.reference}
                    </span>
                  )}
                </InfoRow>
              )}
              <InfoRow label="Date" width={copy.infoLabelWidth}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>
                  {formatDateOnly(purchase.date)}
                </span>
              </InfoRow>
              <InfoRow label="Status" width={copy.infoLabelWidth}>
                <PurchaseStatusPill status={purchase.status} palette={copy.statusPalette} />
              </InfoRow>
              {!purchase.contactCards && (
                <InfoRow label="Warehouse" width={copy.infoLabelWidth}>
                  <span style={{ fontSize: 13.5, color: COLORS.slate }}>{purchase.warehouse.name}</span>
                </InfoRow>
              )}
              {purchase.paymentStatus && (
                <InfoRow label={`${word} status`} width={copy.infoLabelWidth}>
                  <PaymentStatusPill paymentStatus={purchase.paymentStatus} />
                </InfoRow>
              )}
              {!copy.refunds && !copy.noPayment && (
                <InfoRow label={hasPaymentSummary ? "Payment type" : "Payment"} width={copy.infoLabelWidth}>
                  {purchase.paymentType ? (
                    <PaymentTypePill paymentType={purchase.paymentType} />
                  ) : (
                    <span style={{ fontSize: 13.5, color: COLORS.slateLight }}>—</span>
                  )}
                </InfoRow>
              )}
              {!hasPaymentSummary && purchase.paid !== undefined && (
                <InfoRow label="Paid" width={copy.infoLabelWidth}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>
                    {formatNaira(purchase.paid)}
                  </span>
                </InfoRow>
              )}
              {!hasPaymentSummary && purchase.due !== undefined && (
                <InfoRow label="Due" width={copy.infoLabelWidth}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, color: COLORS.ink }}>
                    {formatNaira(purchase.due)}
                  </span>
                </InfoRow>
              )}
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
                  {summaryHeaders.map((label, index) => (
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
                      {copy.unitColumn ? item.quantity : `${item.quantity} ${item.purchaseUnit}`}
                    </span>
                    <span style={{ ...money, color: COLORS.slate }}>
                      {copy.unitColumn ? item.purchaseUnit : formatNaira(item.unitCost)}
                    </span>
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

        {purchase.payments && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={overline}>{word} summary</span>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", gap: 24, alignItems: "start" }}>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: PAYMENTS_GRID,
                    columnGap: 16,
                    alignItems: "center",
                    padding: "0 20px",
                    height: 44,
                    background: COLORS.bgInput,
                    borderBottom: `1px solid ${COLORS.border}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {["Date", "Type", "Notes", "Amount"].map((label) => (
                    <span key={label} style={{ ...overline, textAlign: label === "Amount" ? "right" : "left" }}>
                      {label}
                    </span>
                  ))}
                </div>
                {purchase.payments.length === 0 ? (
                  <div style={{ padding: "18px 20px", fontSize: 13.5, color: COLORS.slateMid }}>No {word.toLowerCase()}s yet.</div>
                ) : (
                  purchase.payments.map((payment) => (
                    <div
                      key={payment.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: PAYMENTS_GRID,
                        columnGap: 16,
                        alignItems: "center",
                        padding: "0 20px",
                        height: 52,
                        borderBottom: `1px solid ${COLORS.bgApp}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text }}>
                        {formatDateOnly(payment.date)}
                      </span>
                      <PaymentTypePill paymentType={payment.paymentType} />
                      <span style={{ fontSize: 13.5, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {payment.notes || "—"}
                      </span>
                      <span style={{ ...money, fontWeight: 600 }}>{formatNaira(payment.amount)}</span>
                    </div>
                  ))
                )}
              </div>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
                <TotalsRow label={copy.refunds ? "Refunded" : "Paid"} value={formatNaira(purchase.paid ?? "0")} />
                <TotalsRow label={copy.refunds ? "Refund due" : "Due"} value={formatNaira(purchase.due ?? "0")} last />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
