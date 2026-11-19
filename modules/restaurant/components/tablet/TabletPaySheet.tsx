"use client";

import { useState } from "react";
import type { PaymentType } from "@prisma/client";
import { formatNaira } from "@/lib/format";
import { PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { newUuid } from "../../lib/newUuid";
import { quickCash, tender } from "../../lib/tender";
import type { SettleOutcome, SettleRequest } from "../order/PaymentModal";
import type { Settled } from "../order/SettledModal";
import { T } from "./tabletTheme";

// PAY on the tablet (Part 6g Step 5): the Part 6 payment, touch-sized —
// how it's paid (cash, card, transfer, cheque), the cash handed over (quick
// amounts or the keypad) and the change, then SETTLE. The rules are the
// till's own (lib/tender) and the server checks the payment again and
// settles the bill as the desktop POS does. Then: what was paid, the
// change to hand back, and DONE.

const TYPES = Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

type Props = {
  title: string;
  // What's due, a plain 2dp number (the server's figure).
  due: string;
  split: boolean;
  settled: Settled | null;
  onSettle: (request: SettleRequest) => Promise<SettleOutcome>;
  onDone: () => void;
  onClose: () => void;
};

export default function TabletPaySheet({ title, due, split, settled, onSettle, onDone, onClose }: Props) {
  const [method, setMethod] = useState<PaymentType>("CASH");
  const [cash, setCash] = useState(due);
  const [typed, setTyped] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newUuid);
  const amount = method === "CASH" ? cash || "0" : due;
  const result = tender(due, "0", [{ paymentType: method, amount }]);

  function key(k: string) {
    setError(null);
    const base = typed ? cash : "";
    setTyped(true);
    if (k === "⌫") return setCash(base.slice(0, -1));
    const next = (base + k).replace(/^0+(?=\d)/, "").slice(0, 9);
    setCash(next);
  }

  async function settle() {
    if (!result.ok || pending) return;
    setPending(true);
    setError(null);
    const outcome = await onSettle({ payments: [{ paymentType: method, amount }], tip: "0", idempotencyKey });
    setPending(false);
    if (!outcome.ok) setError(outcome.error);
  }

  const big = (extra: React.CSSProperties = {}) => ({ border: "none", borderRadius: 8, background: T.edge, color: T.text, fontWeight: 900, fontFamily: "inherit", cursor: "pointer", ...extra }) as const;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 35, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" data-pay-sheet style={{ width: "100%", maxHeight: "96%", overflowY: "auto", background: T.raised, borderRadius: "18px 18px 0 0", padding: "26px 24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 32, fontWeight: 900 }}>Pay · {title}</span>
          <span data-pay-due style={{ fontSize: 40, fontWeight: 900 }}>
            {formatNaira(due)}
          </span>
        </div>

        {settled ? (
          <div data-pay-done style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: T.ok }}>Paid · {formatNaira(settled.paid)}</span>
            <div style={{ padding: "22px 24px", borderRadius: 10, background: T.bg, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: T.quiet }}>Change</span>
              <span data-pay-change style={{ fontSize: 48, fontWeight: 900 }}>
                {formatNaira(settled.change)}
              </span>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: T.quiet }}>
              {settled.reference}
              {settled.printedOn ? ` · receipt on ${settled.printedOn}` : ""}
              {settled.partsLeft ? ` · ${settled.partsLeft} more to pay` : ""}
            </span>
            <button type="button" className="tb-press" data-pay-finish onClick={onDone} style={{ ...big({ height: 112, background: T.pay, fontSize: 30 }) }}>
              DONE
            </button>
          </div>
        ) : split ? (
          <>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.soft }}>This bill is split into parts: pay them on the desktop POS.</span>
            <button type="button" className="tb-press" onClick={onClose} style={{ ...big({ height: 84, fontSize: 22 }) }}>
              CLOSE
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${TYPES.length}, minmax(0, 1fr))`, gap: 8 }}>
              {TYPES.map((type) => (
                <button key={type} type="button" className="tb-press" data-pay-method={type} aria-pressed={method === type} onClick={() => (setMethod(type), setError(null))} style={{ ...big({ height: 84, fontSize: 20, background: method === type ? T.text : T.edge, color: method === type ? "#000" : T.text }) }}>
                  {PAYMENT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
            {method === "CASH" ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "16px 20px", borderRadius: 10, background: T.bg }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: T.quiet }}>Cash given</span>
                  <span data-pay-cash style={{ fontSize: 40, fontWeight: 900 }}>
                    {formatNaira(cash || "0")}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${quickCash(due).length + 1}, minmax(0, 1fr))`, gap: 8 }}>
                  <button type="button" className="tb-press" data-quick-cash="exact" onClick={() => (setCash(due), setTyped(false))} style={{ ...big({ height: 76, fontSize: 19 }) }}>
                    EXACT
                  </button>
                  {quickCash(due).map((v) => (
                    <button key={v.toFixed(0)} type="button" className="tb-press" data-quick-cash={v.toFixed(0)} onClick={() => (setCash(v.toFixed(2)), setTyped(false))} style={{ ...big({ height: 76, fontSize: 19 }) }}>
                      {formatNaira(v.toFixed(0)).replace(/\.00$/, "")}
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: 76, gap: 8 }}>
                  {KEYS.map((k) => (
                    <button key={k} type="button" className="tb-press" data-pay-key={k} onClick={() => key(k)} style={{ ...big({ fontSize: 32, background: k === "⌫" ? T.button : T.buttonAlt }) }}>
                      {k}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span style={{ fontSize: 20, fontWeight: 700, color: T.soft }}>{PAYMENT_TYPE_LABELS[method]}: the exact amount, {formatNaira(due)}.</span>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", minHeight: 40 }}>
              <span data-pay-status style={{ fontSize: 20, fontWeight: 800, color: result.ok ? T.ok : T.danger }}>
                {error ?? (result.ok ? (result.change.greaterThan(0) ? `Change ${formatNaira(result.change.toFixed(2))}` : "Paid in full") : result.error)}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
              <button type="button" className="tb-press" data-pay-cancel disabled={pending} onClick={onClose} style={{ ...big({ height: 112, background: "#000", color: T.lockFg, fontSize: 24 }) }}>
                CANCEL
              </button>
              <button type="button" className="tb-press" data-pay-settle disabled={!result.ok || pending} onClick={() => void settle()} style={{ ...big({ height: 112, background: T.pay, fontSize: 30, opacity: result.ok && !pending ? 1 : 0.45 }) }}>
                {pending ? "SETTLING…" : "SETTLE"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
