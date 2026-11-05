"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { sumSubtotals } from "@/lib/pricing";
import { DecimalInput, Field, SelectInput } from "@/components/purchases/form-fields";
import { PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import PosButton from "@/components/pos/PosButton";
import { POS } from "@/components/pos/theme";
import { MAX_PAYMENT_METHODS, quickCash, tender } from "../../lib/tender";

export type SettleRequest = {
  partId?: string;
  payments: { paymentType: PaymentType; amount: string }[];
  tip: string;
  idempotencyKey: string;
};
export type SettleOutcome = { ok: true } | { ok: false; error: string };

const TYPES = Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[];
const TYPE_OPTIONS = TYPES.map((value) => ({ value, label: PAYMENT_TYPE_LABELS[value] }));
const plain = (value: Decimal) => value.toFixed(2);
const asNumber = (value: string) => (value.trim() === "" || value.trim() === "." ? "0" : value.trim());

// The retail POS Payment pop-up's layout and parts (PosPaymentModal: the
// Total payable band, Field / DecimalInput / SelectInput, PosButton, the
// POS palette) — for a restaurant bill or one part of it, with more than
// one method, quick cash and the waiter's tip. The figures here are a
// guide; the server works out what's due and checks the payment again.
function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0" }}>
      <span style={{ fontSize: 14, color: COLORS.slate }}>{label}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 600, color: COLORS.ink }}>{children}</span>
    </div>
  );
}

export default function PaymentModal({
  title,
  due,
  partId,
  waiter,
  onSubmit,
  onClose,
}: {
  // "Table CB1", "Table CB1 · 1 of 3"
  title: string;
  // What's due, as a plain 2dp number (the server's figure).
  due: string;
  partId?: string;
  // The order's waiter, who a tip goes to (none: no tip).
  waiter: string | null;
  onSubmit: (request: SettleRequest) => Promise<SettleOutcome>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ paymentType: PaymentType; amount: string }[]>([{ paymentType: "CASH", amount: due }]);
  const [tip, setTip] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One per opening of the pop-up: a retry of this payment can't settle twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const tipValue = asNumber(tip);
  const owed = new Decimal(due).plus(tipValue);
  const result = tender(due, tipValue, rows.map((r) => ({ paymentType: r.paymentType, amount: asNumber(r.amount) })));
  const others = (i: number) => sumSubtotals(rows.filter((_, j) => j !== i).map((r) => asNumber(r.amount)));
  // What this row would need to cover for the rest to be paid.
  const leftFor = (i: number) => Decimal.max(owed.minus(others(i)), 0);
  const setRow = (i: number, change: Partial<(typeof rows)[number]>) => setRows((current) => current.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const unused = TYPES.filter((type) => !rows.some((r) => r.paymentType === type));

  function addMethod() {
    const left = Decimal.max(owed.minus(sumSubtotals(rows.map((r) => asNumber(r.amount)))), 0);
    setRows((current) => [...current, { paymentType: unused[0], amount: plain(left) }]);
  }

  async function confirm() {
    if (!result.ok || pending) return;
    setPending(true);
    setError(null);
    const outcome = await onSubmit({ partId, payments: rows.map((r) => ({ paymentType: r.paymentType, amount: asNumber(r.amount) })), tip: tipValue, idempotencyKey });
    setPending(false);
    if (outcome.ok) onClose();
    else setError(outcome.error);
  }

  return (
    // Shown over the Bill panel: a click outside closes this pop-up only.
    <div
      onClick={(event) => {
        event.stopPropagation();
        if (!pending) onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 16px", overflowY: "auto" }}
    >
      <form
        role="dialog"
        aria-label="Payment"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
        style={{ width: 560, maxWidth: "100%", background: "#fff", borderRadius: 16, boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)", animation: "elv-pop .12s ease-out" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Payment · {title}</h3>
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
          <div style={{ padding: "16px 18px", borderRadius: 12, background: POS.indigoTint, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: POS.indigo }}>Total payable</span>
            <span aria-label="Total payable" style={{ fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, color: COLORS.ink }}>
              {formatNaira(due)}
            </span>
          </div>

          <div aria-label="Payment methods" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((row, i) => {
              const label = PAYMENT_TYPE_LABELS[row.paymentType];
              const cashLeft = leftFor(i);
              return (
                <div key={i} data-method={row.paymentType} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "170px 1fr auto auto", gap: 8, alignItems: "end" }}>
                    <Field label={i === 0 ? "Payment type" : "And"}>
                      <SelectInput
                        value={row.paymentType}
                        onChange={(value) => setRow(i, { paymentType: value as PaymentType })}
                        options={TYPE_OPTIONS.filter((o) => o.value === row.paymentType || !rows.some((r) => r.paymentType === o.value))}
                      />
                    </Field>
                    <Field label={row.paymentType === "CASH" ? "Cash received" : `${label} amount`}>
                      <DecimalInput value={row.amount} onChange={(value) => setRow(i, { amount: value })} suffix="₦" ariaLabel={`${label} amount`} autoFocus={i === 0} />
                    </Field>
                    <PosButton
                      title="Exact amount"
                      onClick={() => setRow(i, { amount: plain(cashLeft) })}
                      disabled={pending}
                      style={{ height: 40, padding: "0 12px", borderRadius: 8, background: POS.chip, color: COLORS.slate, fontSize: 13, fontWeight: 600 }}
                      hoverStyle={{ background: POS.chipHover }}
                    >
                      Exact
                    </PosButton>
                    <PosButton
                      aria-label={`Remove ${label}`}
                      title="Remove this method"
                      onClick={() => setRows((current) => current.filter((_, j) => j !== i))}
                      disabled={pending || rows.length === 1}
                      style={{ width: 34, height: 40, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
                      hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
                    >
                      <X size={15} strokeWidth={1.8} />
                    </PosButton>
                  </div>
                  {row.paymentType === "CASH" && quickCash(cashLeft).length > 0 && (
                    <div aria-label="Quick cash" style={{ display: "flex", gap: 8, paddingLeft: 178 }}>
                      {quickCash(cashLeft).map((amount) => (
                        <PosButton
                          key={amount.toFixed(0)}
                          onClick={() => setRow(i, { amount: plain(amount) })}
                          disabled={pending}
                          style={{ height: 32, padding: "0 12px", borderRadius: 8, background: POS.chip, color: COLORS.slate, fontSize: 12.5, fontWeight: 600, fontFamily: FONTS.mono }}
                          hoverStyle={{ background: POS.chipHover }}
                        >
                          {formatNaira(amount.toFixed(0)).replace(/\.00$/, "")}
                        </PosButton>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {rows.length < MAX_PAYMENT_METHODS && (
              <PosButton
                onClick={addMethod}
                disabled={pending}
                style={{ alignSelf: "flex-start", height: 34, padding: "0 12px", borderRadius: 8, background: "transparent", color: POS.indigo, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
                hoverStyle={{ background: POS.indigoTint }}
              >
                <Plus size={14} strokeWidth={2} />
                Add a payment method
              </PosButton>
            )}
          </div>

          <Field label={waiter ? `Tip for ${waiter} (optional)` : "Tip"}>
            {waiter ? (
              <DecimalInput value={tip} onChange={setTip} suffix="₦" ariaLabel="Tip" />
            ) : (
              <span style={{ fontSize: 13, color: COLORS.slateMid }}>Choose the waiter on the order to take a tip — tips go to the waiter.</span>
            )}
          </Field>

          <div style={{ borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`, padding: "4px 0" }}>
            {owed.greaterThan(due) && <Row label="Bill + tip">{formatNaira(plain(owed))}</Row>}
            <Row label="Received">{formatNaira(plain(result.collected))}</Row>
            <Row label="Change" strong>
              <span aria-label="Change">{formatNaira(plain(result.ok ? result.change : new Decimal(0)))}</span>
            </Row>
            {!result.ok && result.short.greaterThan(0) && (
              <Row label="Still due">
                <span aria-label="Still due">{formatNaira(plain(result.short))}</span>
              </Row>
            )}
          </div>

          {(error || (!result.ok && !result.short.greaterThan(0))) && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 10, background: COLORS.dangerBg, border: `1px solid ${COLORS.dangerBorder}`, fontSize: 13.5, color: COLORS.danger }}>
              {error ?? (!result.ok ? result.error : null)}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <PosButton onClick={onClose} disabled={pending} style={{ height: 52, borderRadius: 12, background: POS.chip, color: COLORS.slate, fontSize: 15, fontWeight: 600 }} hoverStyle={{ background: POS.chipHover }}>
              Cancel
            </PosButton>
            <PosButton
              type="submit"
              disabled={pending || !result.ok}
              title={!result.ok ? result.error : undefined}
              style={{ height: 52, borderRadius: 12, background: POS.green, color: "#fff", fontSize: 16, fontWeight: 600 }}
              hoverStyle={{ background: POS.greenHover }}
            >
              {pending ? "Settling…" : `Settle ${formatNaira(due)}`}
            </PosButton>
          </div>
        </div>
      </form>
    </div>
  );
}
