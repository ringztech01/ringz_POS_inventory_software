import { formatDateForInput, formatNaira } from "@/lib/format";
import type { PurchaseDocument } from "@/app/(dashboard)/purchases/queries";
import { PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { COLORS, FONTS } from "@/components/layout/theme";

const line = { display: "flex", justifyContent: "space-between", gap: 12 } as const;
const rule = { borderTop: `1px dashed ${COLORS.borderStrong}`, margin: "10px 0" } as const;

// The till receipt for a sale (the POS receipt page, and the restaurant's
// receipt for a settled bill): the same document the Sale Details page and
// its PDF render (getSaleDocument), laid out for a receipt printer.
// `details`: more header rows after Customer (the restaurant's order, table
// and waiter); `shippingLabel`: what Shipping is called (the restaurant's
// service charge); `afterPayments`: rows after the payments (a tip).
export default function SaleReceipt({
  sale,
  details = [],
  shippingLabel = "Shipping",
  afterPayments = [],
}: {
  sale: PurchaseDocument;
  details?: readonly (readonly [string, string])[];
  shippingLabel?: string;
  afterPayments?: readonly (readonly [string, string])[];
}) {
  const [year, month, day] = formatDateForInput(sale.date).split("-");

  return (
    <article
      aria-label="Receipt"
      style={{
        width: 340,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 4px 16px -6px rgba(23,27,28,.18)",
        padding: "22px 20px",
        fontFamily: FONTS.mono,
        fontSize: 12.5,
        color: COLORS.ink,
        lineHeight: 1.5,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 700 }}>RingzPOS</div>
        <div style={{ color: COLORS.slateMid }}>{sale.warehouse.name}</div>
      </div>
      <div style={rule} />
      <div style={line}>
        <span>Receipt</span>
        <span style={{ fontWeight: 600 }}>{sale.reference}</span>
      </div>
      <div style={line}>
        <span>Date</span>
        <span>{`${day}/${month}/${year}`}</span>
      </div>
      <div style={line}>
        <span>Customer</span>
        <span>{sale.party.name}</span>
      </div>
      {details.map(([label, value]) => (
        <div key={label} style={line}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <div style={rule} />

      {sale.items.map((item) => (
        <div key={item.id} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: FONTS.body, fontWeight: 600 }}>{item.name}</div>
          <div style={line}>
            <span style={{ color: COLORS.slate }}>
              {item.quantity} × {formatNaira(item.unitCost)}
            </span>
            <span>{formatNaira(item.subtotal)}</span>
          </div>
        </div>
      ))}
      <div style={rule} />

      {[
        [`Order tax (${sale.orderTaxRate}%)`, sale.orderTaxAmount],
        ["Discount", sale.discount],
        [shippingLabel, sale.shipping],
      ].map(([label, value]) => (
        <div key={label} style={line}>
          <span>{label}</span>
          <span>{formatNaira(value)}</span>
        </div>
      ))}
      <div style={{ ...line, fontSize: 15, fontWeight: 700, marginTop: 4 }}>
        <span>Total</span>
        <span aria-label="Grand total">{formatNaira(sale.grandTotal)}</span>
      </div>
      <div style={rule} />

      {(sale.payments ?? []).map((payment) => (
        <div key={payment.id} style={line}>
          <span>Paid · {PAYMENT_TYPE_LABELS[payment.paymentType]}</span>
          <span>{formatNaira(payment.amount)}</span>
        </div>
      ))}
      <div style={line}>
        <span>Due</span>
        <span>{formatNaira(sale.due ?? "0")}</span>
      </div>
      {sale.paymentStatus && (
        <div style={line}>
          <span>Status</span>
          <span>{PAYMENT_STATUS_LABELS[sale.paymentStatus]}</span>
        </div>
      )}
      {afterPayments.map(([label, value]) => (
        <div key={label} style={line}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <div style={rule} />
      <div style={{ textAlign: "center", color: COLORS.slateMid, fontFamily: FONTS.body }}>Thank you for your purchase.</div>
    </article>
  );
}
