"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { toDecimal } from "@/lib/pricing";
import { computePaymentState } from "@/lib/payments";
import { DecimalInput, Field, SelectInput } from "@/components/purchases/form-fields";
import { PAYMENT_TYPE_LABELS, PaymentStatusPill } from "@/components/purchases/purchase-display";
import PosButton from "./PosButton";
import { POS } from "./theme";

const PAYMENT_TYPE_OPTIONS = (Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((value) => ({
  value,
  label: PAYMENT_TYPE_LABELS[value],
}));

// What the cashier takes, given the amount received: the payment recorded is
// at most the total (the rest is change), and the status pill is the one the
// sale will get (computePaymentState — the server's own helper).
export function tenderFor(grandTotal: string, received: string) {
  const total = toDecimal(grandTotal);
  const amount = toDecimal(received);
  const paid = amount.greaterThan(total) ? total : amount;
  return {
    paid,
    change: amount.greaterThan(total) ? amount.minus(total) : toDecimal(0),
    due: total.minus(paid),
    paymentStatus: computePaymentState(total, paid.isZero() ? [] : [{ amount: paid.toFixed(2), paymentType: "CASH", date: new Date() }])
      .paymentStatus,
  };
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0" }}>
      <span style={{ fontSize: 14, color: COLORS.slate }}>{label}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 600, color: COLORS.ink }}>{children}</span>
    </div>
  );
}

// Pay Now: the total, the amount received, the payment type, and the change.
// Confirm runs createPosSale; while it runs every control is locked, so a
// double-click can't send two sales.
export default function PosPaymentModal({
  grandTotal,
  pending,
  error,
  blocked,
  onConfirm,
  onClose,
}: {
  // 2dp string from computeOrder.
  grandTotal: string;
  pending: boolean;
  // The server's message from the last attempt.
  error: string | null;
  // Why the sale can't be completed right now (e.g. lines over stock).
  blocked: string | null;
  onConfirm: (payment: { received: string; paymentType: PaymentType }) => void;
  onClose: () => void;
}) {
  const [received, setReceived] = useState(grandTotal);
  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");
  const tender = tenderFor(grandTotal, received);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    <div
      onClick={() => !pending && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(23,27,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "80px 16px",
      }}
    >
      <form
        role="dialog"
        aria-label="Payment"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && !blocked) onConfirm({ received, paymentType });
        }}
        style={{
          width: 520,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)",
          animation: "elv-pop .12s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Payment</h3>
          <PosButton
            title="Close"
            aria-label="Close"
            onClick={onClose}
            disabled={pending}
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
          >
            <X size={17} strokeWidth={1.8} />
          </PosButton>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: POS.indigoTint,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: POS.indigo }}>Total payable</span>
            <span aria-label="Total payable" style={{ fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, color: COLORS.ink }}>
              {formatNaira(grandTotal)}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Amount received">
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <DecimalInput value={received} onChange={setReceived} suffix="₦" ariaLabel="Amount received" autoFocus />
                </div>
                <PosButton
                  title="Exact amount"
                  onClick={() => setReceived(grandTotal)}
                  disabled={pending}
                  style={{ height: 40, padding: "0 12px", borderRadius: 8, background: POS.chip, color: COLORS.slate, fontSize: 13, fontWeight: 600 }}
                  hoverStyle={{ background: POS.chipHover }}
                >
                  Exact
                </PosButton>
              </div>
            </Field>
            <Field label="Payment type">
              <SelectInput value={paymentType} onChange={(value) => setPaymentType(value as PaymentType)} options={PAYMENT_TYPE_OPTIONS} />
            </Field>
          </div>

          <div style={{ borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`, padding: "4px 0" }}>
            <Row label="Paying now">{formatNaira(tender.paid.toFixed(2))}</Row>
            <Row label="Change" strong>
              <span aria-label="Change">{formatNaira(tender.change.toFixed(2))}</span>
            </Row>
            {tender.due.greaterThan(0) && <Row label="Still due">{formatNaira(tender.due.toFixed(2))}</Row>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0" }}>
              <span style={{ fontSize: 14, color: COLORS.slate }}>Payment status</span>
              <span aria-label="Payment status">
                <PaymentStatusPill paymentStatus={tender.paymentStatus} />
              </span>
            </div>
          </div>

          {(error || blocked) && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: COLORS.dangerBg,
                border: `1px solid ${COLORS.dangerBorder}`,
                fontSize: 13.5,
                color: COLORS.danger,
              }}
            >
              {blocked ?? error}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <PosButton
              onClick={onClose}
              disabled={pending}
              style={{ height: 52, borderRadius: 12, background: POS.chip, color: COLORS.slate, fontSize: 15, fontWeight: 600 }}
              hoverStyle={{ background: POS.chipHover }}
            >
              Cancel
            </PosButton>
            <PosButton
              type="submit"
              disabled={pending || !!blocked}
              style={{ height: 52, borderRadius: 12, background: POS.green, color: "#fff", fontSize: 16, fontWeight: 600 }}
              hoverStyle={{ background: POS.greenHover }}
            >
              {pending ? "Completing sale…" : "Complete sale"}
            </PosButton>
          </div>
        </div>
      </form>
    </div>
  );
}
