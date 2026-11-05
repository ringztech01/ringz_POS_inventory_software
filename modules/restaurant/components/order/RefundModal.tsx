"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { computeLine } from "@/lib/pricing";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import PosButton from "@/components/pos/PosButton";
import { POS } from "@/components/pos/theme";
import { planRefund } from "../../lib/refund";
import { R } from "../../lib/theme";
import { REFUND_REASON_MAX } from "../../schemas/bill";
import type { RefundView } from "../../server/queries/refund";

export type RefundRequest = {
  lines: { saleItemId: string; quantity: number }[];
  returnToStock: boolean;
  paymentType: PaymentType;
  reason: string;
  idempotencyKey: string;
};
export type RefundOutcome = { ok: true } | { ok: false; error: string };

const TYPE_OPTIONS = (Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((value) => ({ value, label: PAYMENT_TYPE_LABELS[value] }));
const money = (value: { toFixed: (n: number) => string }) => formatNaira(value.toFixed(2));

// Refund (a settled bill — it's never reopened): which dishes and how many,
// whether they go back into stock (their ingredients as settled), why, and
// how the money goes back. Saved as a retail Sale Return against the bill's
// sale. The preview is lib/refund.ts — the server works it out again.
export default function RefundModal({
  title,
  view,
  onSubmit,
  onClose,
}: {
  title: string;
  view: RefundView;
  onSubmit: (request: RefundRequest) => Promise<RefundOutcome>;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [returnToStock, setReturnToStock] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>("CASH");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const chosen = Object.entries(picks)
    .filter(([, quantity]) => quantity > 0)
    .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
  const plan = planRefund(view.sale, view.lines, chosen);
  const anyLeft = view.lines.some((line) => line.sold > line.returned);
  const ready = plan.ok && reason.trim() !== "" && !pending;

  async function confirm() {
    if (!ready) return;
    setPending(true);
    setError(null);
    const outcome = await onSubmit({ lines: chosen, returnToStock, paymentType, reason: reason.trim(), idempotencyKey });
    setPending(false);
    if (outcome.ok) onClose();
    else setError(outcome.error);
  }

  return (
    <div onClick={() => !pending && onClose()} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 16px", overflowY: "auto" }}>
      <form
        role="dialog"
        aria-label="Refund"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
        style={{ width: 560, maxWidth: "100%", background: "#fff", borderRadius: 16, boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)", animation: "elv-pop .12s ease-out" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Refund · {title}</h3>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
              A return against sale <span style={{ fontFamily: FONTS.mono }}>{view.saleReference}</span>
            </span>
          </div>
          <PosButton
            aria-label="Close"
            onClick={onClose}
            disabled={pending}
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
          >
            <X size={17} strokeWidth={1.8} />
          </PosButton>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div aria-label="Dishes" style={{ display: "flex", flexDirection: "column" }}>
            {view.lines.map((line) => {
              const left = line.sold - line.returned;
              const quantity = picks[line.saleItemId] ?? 0;
              const each = computeLine({ ...line, quantity: 1 }).subtotal;
              const set = (n: number) => setPicks((current) => ({ ...current, [line.saleItemId]: Math.max(0, Math.min(left, n)) }));
              return (
                <div key={line.saleItemId} data-refund-line={line.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${R.rowBorder}` }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{line.name}</span>
                    <span style={{ fontSize: 12, color: COLORS.slateMid }}>
                      {line.sold} sold · {money(each)} each{line.returned ? ` · ${line.returned} refunded` : ""}
                    </span>
                  </span>
                  {left === 0 ? (
                    <span style={{ fontSize: 12, color: COLORS.slateMid }}>All refunded</span>
                  ) : (
                    <span role="group" aria-label={`${line.name} to refund`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <PosButton aria-label={`One less ${line.name}`} onClick={() => set(quantity - 1)} disabled={quantity === 0 || pending} style={{ width: 28, height: 28, borderRadius: 7, background: POS.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Minus size={13} strokeWidth={2} />
                      </PosButton>
                      <span style={{ minWidth: 34, textAlign: "center", fontFamily: FONTS.mono, fontSize: 13 }}>
                        {quantity}/{left}
                      </span>
                      <PosButton aria-label={`One more ${line.name}`} onClick={() => set(quantity + 1)} disabled={quantity >= left || pending} style={{ width: 28, height: 28, borderRadius: 7, background: POS.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Plus size={13} strokeWidth={2} />
                      </PosButton>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <Field label="Reason" required>
            <input
              aria-label="Reason"
              value={reason}
              maxLength={REFUND_REASON_MAX}
              placeholder="e.g. Served cold"
              onChange={(event) => setReason(event.target.value)}
              style={{ height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none" }}
            />
          </Field>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" aria-label="Return to stock" checked={returnToStock} onChange={(event) => setReturnToStock(event.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>Return to stock</span>
              <span style={{ fontSize: 12, color: COLORS.slateMid }}>Puts these dishes&apos; ingredients back, as they were when the bill was settled. Leave it unticked for food that was eaten or thrown away.</span>
            </span>
          </label>
          <Field label="Refund by">
            <SelectInput value={paymentType} onChange={(value) => setPaymentType(value as PaymentType)} options={TYPE_OPTIONS} />
          </Field>

          {plan.ok && (
            <div aria-label="Refund amount" style={{ borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`, padding: "6px 0" }}>
              {[
                ["Dishes", money(plan.itemsTotal)],
                ...(plan.discount.isZero() ? [] : [["Their share of the discount", `−${money(plan.discount)}`]]),
                ...(plan.shipping.isZero() ? [] : [["Their share of the service charge", money(plan.shipping)]]),
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5, color: COLORS.slate }}>
                  <span>{label}</span>
                  <span style={{ fontFamily: FONTS.mono }}>{value}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 2px", fontSize: 16, fontWeight: 700 }}>
                <span>Refund</span>
                <span aria-label="Refund total">{money(plan.total)}</span>
              </div>
            </div>
          )}

          {view.refunds.length > 0 && (
            <div aria-label="Earlier refunds" style={{ fontSize: 12.5, color: COLORS.slateMid, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontWeight: 600, color: COLORS.slate }}>Refunded so far</span>
              {view.refunds.map((r) => (
                <span key={r.reference} data-refund={r.reference}>
                  <span style={{ fontFamily: FONTS.mono }}>{r.reference}</span> · {formatNaira(r.amount)} · {r.returnedToStock ? "back in stock" : "not back in stock"}
                </span>
              ))}
            </div>
          )}

          {(error || (!anyLeft && "Everything on this bill has been refunded.")) && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 10, background: COLORS.dangerBg, border: `1px solid ${COLORS.dangerBorder}`, fontSize: 13.5, color: COLORS.danger }}>
              {error ?? "Everything on this bill has been refunded."}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <PosButton onClick={onClose} disabled={pending} style={{ height: 50, borderRadius: 12, background: POS.chip, color: COLORS.slate, fontSize: 15, fontWeight: 600 }} hoverStyle={{ background: POS.chipHover }}>
              Cancel
            </PosButton>
            <PosButton
              type="submit"
              disabled={!ready}
              title={!plan.ok ? plan.error : reason.trim() === "" ? "Give a reason for the refund." : undefined}
              style={{ height: 50, borderRadius: 12, background: POS.red, color: "#fff", fontSize: 16, fontWeight: 600 }}
              hoverStyle={{ background: POS.redHover }}
            >
              {pending ? "Refunding…" : plan.ok ? `Refund ${money(plan.total)}` : "Refund"}
            </PosButton>
          </div>
        </div>
      </form>
    </div>
  );
}
