import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { formatDateForInput, formatNaira } from "@/lib/format";
import { getSaleDocument } from "@/app/(dashboard)/sales/queries";
import { PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrintOnOpen from "@/components/pos/PrintOnOpen";

export const metadata: Metadata = { title: "Receipt — RingzPOS" };

const line = { display: "flex", justifyContent: "space-between", gap: 12 } as const;
const rule = { borderTop: `1px dashed ${COLORS.borderStrong}`, margin: "10px 0" } as const;

// /pos/receipt/[id] — the till receipt for a sale: the same document the Sale
// Details page and its PDF render (getSaleDocument), laid out for a receipt
// printer. Manage Pos Screen, so a cashier without Manage Sale can print it.
export default async function PosReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_POS_SCREEN);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const { id } = await params;
  const sale = await getSaleDocument(id);
  if (!sale) notFound();

  const [year, month, day] = formatDateForInput(sale.date).split("-");

  return (
    <div style={{ padding: "32px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <style>{`@media print { .no-print { display:none !important; } body, body > div { background:#fff !important; min-width:0 !important; } }`}</style>
      <PrintOnOpen />

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
          ["Shipping", sale.shipping],
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
        <div style={rule} />
        <div style={{ textAlign: "center", color: COLORS.slateMid, fontFamily: FONTS.body }}>Thank you for your purchase.</div>
      </article>
    </div>
  );
}
