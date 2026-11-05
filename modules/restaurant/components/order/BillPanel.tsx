"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Percent, Printer, Split, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatAppTime } from "../../lib/time";
import { R } from "../../lib/theme";
import type { BillSplit } from "../../schemas/bill";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import DiscountModal, { type DiscountOutcome, type DiscountRequest } from "./DiscountModal";
import PaymentModal, { type SettleOutcome, type SettleRequest } from "./PaymentModal";
import SplitModal from "./SplitModal";

// The Bill panel (Table Order design's "Bill & pay"): what the guest will
// pay — billed lines with their options and the totals, all worked out on
// the server — with the warnings, the discount and the service charge
// switch, the split, Print bill (the pre-bill, NOT A RECEIPT) and Settle
// (the whole bill, or each part of a split one, in the Payment pop-up).
// Discount, service charge, split and settle are order changes: they go
// through the order screen's queue with its version, like every other
// change.

type Popup = "discount" | "split" | { pay: { partId?: string; title: string; due: string } };
const AMBER = { background: "#fff4e0", color: "#8a5a00" } as const;
const smallButton = (disabled: boolean) =>
  ({
    height: 34,
    padding: "0 12px",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8,
    background: "#fff",
    color: disabled ? COLORS.slateLight : COLORS.tealDark,
    fontSize: 13,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: disabled ? "not-allowed" : "pointer",
  }) as const;

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: strong ? 18 : 13.5, fontWeight: strong ? 600 : 400, fontFamily: strong ? FONTS.display : undefined, color: strong ? COLORS.ink : COLORS.slate }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function BillPanel({
  bill,
  approvers,
  busy,
  onDiscount,
  onServiceCharge,
  onSplit,
  onRemoveSplit,
  canSettle,
  onSettle,
  onClose,
}: {
  bill: BillView;
  approvers: Approver[];
  busy: boolean;
  onDiscount: (request: DiscountRequest) => Promise<DiscountOutcome>;
  onServiceCharge: (on: boolean) => void;
  onSplit: (split: BillSplit) => Promise<boolean>;
  onRemoveSplit: () => void;
  // The signed-in user has Settle Bill.
  canSettle: boolean;
  onSettle: (request: SettleRequest) => Promise<SettleOutcome>;
  onClose: () => void;
}) {
  const { order, lines, totals, discount, split } = bill;
  const [popup, setPopup] = useState<Popup | null>(null);
  const closePopup = useCallback(() => setPopup(null), []);
  // A split needs a bill that could be settled: everything sent, something billed.
  const splitBlocker = busy ? "Saving…" : bill.settleBlocker;
  // Taking payment: the whole bill here, or each part from the split's list.
  const payBlocker = !canSettle ? "Needs the Settle Bill permission." : (splitBlocker ?? (split?.stale ? "The split no longer adds up. Split it again." : null));
  const settleBlocker = payBlocker ?? (split ? "This bill is split — take payment for each part above." : null);

  // Escape closes a pop-up first (each has its own handler).
  useEffect(() => {
    if (popup) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, popup]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}>
      <div
        role="dialog"
        aria-label={`Bill ${order.ref}`}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 480, maxHeight: "88vh", background: "#fff", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 600 }}>Bill · {order.table}</span>
            <span data-bill-meta style={{ fontSize: 12.5, color: COLORS.slateMid }}>
              <span style={{ fontFamily: FONTS.mono }}>{order.ref}</span> · {order.type} · {order.guests} {order.guests === 1 ? "guest" : "guests"} · {order.waiter}
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex" }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        {bill.unsent > 0 && (
          <p role="alert" data-warning="unsent" style={{ margin: 0, padding: "10px 12px", borderRadius: 9, background: COLORS.dangerBg, color: COLORS.danger, fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Ban size={15} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{bill.settleBlocker}</span>
          </p>
        )}
        {bill.notServed > 0 && (
          <p data-warning="not-served" style={{ margin: 0, padding: "10px 12px", borderRadius: 9, ...AMBER, fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={15} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {bill.notServed} {bill.notServed === 1 ? "line isn't" : "lines aren't"} served yet. You can still settle.
            </span>
          </p>
        )}

        <div aria-label="Bill lines" style={{ overflowY: "auto", minHeight: 0, borderTop: `1px solid ${R.rowBorder}` }}>
          {lines.length === 0 ? (
            <p style={{ margin: "12px 0", fontSize: 13.5, color: COLORS.slateMid }}>Nothing sent to the kitchen yet, so nothing to bill.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} data-bill-line={line.name} style={{ padding: "9px 0", borderBottom: `1px solid ${R.rowBorder}`, display: "flex", gap: 10 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 13, minWidth: 26 }}>{line.quantity}×</span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {line.name}
                    {!line.served && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#8a5a00" }}>{line.status}</span>}
                  </span>
                  {line.modifiers.map((m, i) => (
                    <span key={i} style={{ fontSize: 12, color: COLORS.slateMid }}>
                      + {m.name}
                      {m.price ? ` ${m.price}` : ""}
                    </span>
                  ))}
                  {line.note && <span style={{ fontSize: 12, color: COLORS.slateMid }}>» {line.note}</span>}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{line.amount}</span>
              </div>
            ))
          )}
        </div>

        {order.editable && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => setPopup("discount")} disabled={busy} style={smallButton(busy)}>
              <Percent size={14} strokeWidth={1.8} />
              {discount ? "Change discount" : "Discount"}
            </button>
            <button type="button" onClick={() => setPopup("split")} disabled={!!splitBlocker} title={splitBlocker ?? undefined} style={smallButton(!!splitBlocker)}>
              <Split size={14} strokeWidth={1.8} />
              {split ? "Change split" : "Split bill"}
            </button>
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.slate }}>
              Service charge
              <button
                type="button"
                role="switch"
                aria-label="Service charge"
                aria-checked={order.serviceCharge}
                disabled={busy}
                onClick={() => onServiceCharge(!order.serviceCharge)}
                style={{ width: 38, height: 22, borderRadius: 11, border: "none", padding: 2, background: order.serviceCharge ? COLORS.teal : COLORS.borderStrong, display: "flex", justifyContent: order.serviceCharge ? "flex-end" : "flex-start", cursor: busy ? "not-allowed" : "pointer" }}
              >
                <span style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
              </button>
            </span>
          </div>
        )}

        <div aria-label="Bill totals" aria-busy={busy} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: busy ? 0.4 : 1, transition: "opacity .15s" }}>
          <TotalRow label="Sub total" value={totals.subTotal} />
          {discount && (
            <>
              <TotalRow label={`Discount (${discount.label})`} value={`−${totals.discount}`} />
              <span data-discount-note style={{ fontSize: 11.5, color: COLORS.slateMid, marginTop: -4 }}>
                {discount.reason}
                {discount.by ? ` · by ${discount.by}` : ""}
                {discount.approvedBy ? ` · approved by ${discount.approvedBy}` : ""}
              </span>
            </>
          )}
          <TotalRow label={`Service charge (${totals.servicePercent})`} value={totals.serviceCharge} />
          <TotalRow label={totals.taxLabel} value={totals.tax} />
          <TotalRow label="Total" value={totals.total} strong />
        </div>

        {split && (
          <section aria-label="Split" style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {split.modeLabel} · {split.parts.length} parts
              </span>
              {order.editable && (
                <button
                  type="button"
                  onClick={onRemoveSplit}
                  disabled={busy}
                  style={{ marginLeft: "auto", border: "none", background: "none", padding: 0, fontSize: 12.5, fontWeight: 600, color: busy ? COLORS.slateLight : COLORS.tealDark, cursor: busy ? "not-allowed" : "pointer" }}
                >
                  Pay as one bill
                </button>
              )}
            </div>
            {split.stale && (
              <span role="alert" style={{ fontSize: 12, ...AMBER, padding: "4px 8px", borderRadius: 6 }}>
                The parts no longer add up to the total. Split it again.
              </span>
            )}
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {split.parts.map((part) => (
                <div key={part.id} data-bill-part={part.label} style={{ display: "flex", gap: 10, padding: "5px 0", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13 }}>
                  <span style={{ minWidth: 64, fontWeight: 600 }}>{part.label}</span>
                  <span style={{ flex: 1, minWidth: 0, color: COLORS.slateMid, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {part.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: part.status === "PAID" ? COLORS.tealDark : COLORS.slateMid }}>{part.status === "PAID" ? "Paid" : "Open"}</span>
                  <span style={{ minWidth: 80, textAlign: "right", fontWeight: 600 }}>{part.amount}</span>
                  {order.editable && part.status === "OPEN" && (
                    <button
                      type="button"
                      aria-label={`Pay ${part.label}`}
                      disabled={!!payBlocker}
                      title={payBlocker ?? `Take payment for ${part.label}`}
                      onClick={() => setPopup({ pay: { partId: part.id, title: `${order.table} · ${part.label}`, due: part.amountValue } })}
                      style={{ height: 24, padding: "0 10px", border: "none", borderRadius: 6, background: payBlocker ? COLORS.borderStrong : COLORS.teal, color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: payBlocker ? "not-allowed" : "pointer" }}
                    >
                      Pay
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {order.billChangedAt ? (
          <span data-printed="changed" role="status" style={{ fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 7, ...AMBER, display: "flex", gap: 6, alignItems: "center" }}>
            <AlertTriangle size={13} strokeWidth={1.8} />
            Bill changed since print — print it again before the guest pays.
          </span>
        ) : (
          <span data-printed style={{ fontSize: 12, color: COLORS.slateMid }}>
            {order.billPrintedAt ? `Bill printed at ${formatAppTime(new Date(order.billPrintedAt))}.` : "Bill not printed yet."}
          </span>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <a
            href={`/restaurant/bill/${order.id}?autoprint=1`}
            target="_blank"
            rel="noopener"
            aria-disabled={lines.length === 0}
            style={{
              height: 44,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 600,
              color: lines.length ? COLORS.tealDark : COLORS.slateLight,
              textDecoration: "none",
              pointerEvents: lines.length ? "auto" : "none",
            }}
          >
            <Printer size={15} strokeWidth={1.7} />
            Print bill
          </a>
          <button
            type="button"
            disabled={!!settleBlocker || !order.editable}
            title={settleBlocker ?? undefined}
            onClick={() => setPopup({ pay: { title: order.table, due: totals.totalValue } })}
            style={{ height: 44, border: "none", borderRadius: 9, background: settleBlocker || !order.editable ? COLORS.slateLight : COLORS.teal, color: "#fff", fontSize: 14, fontWeight: 600, cursor: settleBlocker || !order.editable ? "not-allowed" : "pointer" }}
          >
            Settle
          </button>
        </div>
      </div>
      {popup === "discount" && <DiscountModal bill={bill} approvers={approvers} onSubmit={onDiscount} onClose={closePopup} />}
      {popup === "split" && <SplitModal bill={bill} onSubmit={onSplit} onClose={closePopup} />}
      {popup && typeof popup === "object" && (
        <PaymentModal
          title={popup.pay.title}
          due={popup.pay.due}
          partId={popup.pay.partId}
          waiter={order.hasWaiter ? order.waiter : null}
          onSubmit={onSettle}
          onClose={closePopup}
        />
      )}
    </div>
  );
}
