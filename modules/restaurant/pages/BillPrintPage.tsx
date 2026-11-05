import { notFound } from "next/navigation";
import { COMPANY } from "@/lib/company";
import { NOT_A_RECEIPT } from "../lib/bill";
import { formatAppDateTime } from "../lib/time";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getBill } from "../server/queries/bill";
import BillPrintControls from "../components/order/BillPrintControls";

// /restaurant/bill/[id][?autoprint=1] — the guest's pre-bill on an 80mm
// printer: what they'll pay, marked NOT A RECEIPT (the receipt comes from
// the sale at settle). Billed lines only — never unsent or cancelled ones.

const rule = { borderTop: "1px dashed #000", margin: "6px 0" } as const;
const row = { display: "flex", justifyContent: "space-between", gap: 8 } as const;

export default async function BillPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ autoprint?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
  if (denied) return denied;

  const [{ id }, { autoprint }] = await Promise.all([params, searchParams]);
  const bill = await getBill(id);
  if (!bill) notFound();
  const { order, lines, totals } = bill;

  return (
    <div style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
      {/* As the KOT: browsers drop "size: 80mm auto", so the roll comes from
          the printer's paper setting; margin: 0 applies. */}
      <style>{`
        @page { size: 80mm auto; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body, body > div, body > div > div { background: #fff !important; padding: 0 !important; }
          .bill { box-shadow: none !important; margin: 0 !important; }
        }
      `}</style>
      <article
        className="bill"
        aria-label={`Bill ${order.ref}`}
        style={{ width: "80mm", padding: "4mm", background: "#fff", color: "#000", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", fontSize: 13, lineHeight: 1.35, boxShadow: "0 4px 18px rgba(0,0,0,.18)" }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{COMPANY.name}</div>
          <div style={{ fontSize: 11.5 }}>{COMPANY.address}</div>
          <div style={{ fontSize: 11.5 }}>{COMPANY.phone}</div>
        </div>
        <div data-not-receipt style={{ margin: "8px 0 6px", padding: "3px 0", border: "2px solid #000", textAlign: "center", fontWeight: 700, fontSize: 16, letterSpacing: ".08em" }}>
          *** {NOT_A_RECEIPT} ***
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 26, lineHeight: 1.1 }}>{order.table}</div>
        <div style={row}>
          <span style={{ fontWeight: 700 }}>{order.ref}</span>
          <span>{order.type}</span>
        </div>
        <div style={row}>
          <span>{formatAppDateTime(new Date())}</span>
          <span>{order.waiter}</span>
        </div>
        <div>
          {order.guests} {order.guests === 1 ? "guest" : "guests"}
        </div>
        <div style={rule} />
        {lines.length === 0 && <div>Nothing to bill yet.</div>}
        {lines.map((line) => (
          <div key={line.id} data-bill-line style={{ marginBottom: 4 }}>
            <div style={row}>
              <span style={{ display: "flex", gap: 6 }}>
                <span>{line.quantity}x</span>
                <span style={{ fontWeight: 700 }}>{line.name}</span>
              </span>
              <span>{line.amount}</span>
            </div>
            {line.modifiers.map((m, i) => (
              <div key={i} style={{ paddingLeft: 24, fontSize: 12 }}>
                + {m.name}
                {m.price ? ` ${m.price}` : ""}
              </div>
            ))}
            {line.note && <div style={{ paddingLeft: 24, fontSize: 12 }}>» {line.note}</div>}
          </div>
        ))}
        <div style={rule} />
        <div style={row}>
          <span>Sub total</span>
          <span>{totals.subTotal}</span>
        </div>
        {bill.discount && (
          <div data-bill-discount style={row}>
            <span>Discount ({bill.discount.label})</span>
            <span>−{totals.discount}</span>
          </div>
        )}
        {order.serviceCharge && (
          <div style={row}>
            <span>Service charge ({totals.servicePercent})</span>
            <span>{totals.serviceCharge}</span>
          </div>
        )}
        <div style={row}>
          <span>{totals.taxLabel}</span>
          <span>{totals.tax}</span>
        </div>
        <div data-bill-total style={{ ...row, fontWeight: 700, fontSize: 16, marginTop: 4 }}>
          <span>TOTAL</span>
          <span>{totals.total}</span>
        </div>
        {bill.split && (
          <>
            <div style={rule} />
            <div style={{ fontWeight: 700 }}>
              {bill.split.modeLabel} · {bill.split.parts.length} parts
            </div>
            {bill.split.parts.map((part) => (
              <div key={part.id} data-bill-part style={{ marginBottom: 2 }}>
                <div style={row}>
                  <span>{part.label}</span>
                  <span>{part.amount}</span>
                </div>
                {part.items.length > 0 && (
                  <div style={{ paddingLeft: 12, fontSize: 11.5 }}>{part.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</div>
                )}
              </div>
            ))}
          </>
        )}
        <div style={rule} />
        <div style={{ textAlign: "center", fontSize: 11.5 }}>{NOT_A_RECEIPT} — please pay at the counter or ask your waiter.</div>
        <BillPrintControls orderId={order.id} autoprint={autoprint === "1"} />
      </article>
    </div>
  );
}
