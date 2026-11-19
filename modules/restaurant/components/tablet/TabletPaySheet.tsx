"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { formatNaira } from "@/lib/format";
import { newUuid } from "@/lib/newUuid";
import { quickCash, tender } from "../../lib/tender";
import { assignUnit, buildCards, emptyUnits, removeGuest, restTo, returnUnit, toParts, unassigned, type Units } from "../../lib/splitAssign";
import { addMethod, billOpen, keyed, leftFor, setMethod, TABLET_DISCOUNT_REASONS, TABLET_MAX_GUESTS, TABLET_METHOD_LABEL, TABLET_METHODS, TABLET_SPLIT_WAYS, TIP_PERCENTS, tipFor, type PayRow } from "../../lib/tabletPay";
import type { BillSplit } from "../../schemas/bill";
import type { Approver } from "../../server/queries/approvers";
import type { BillView } from "../../server/queries/bill";
import type { DiscountOutcome, DiscountRequest } from "../order/DiscountModal";
import type { SettleOutcome, SettleRequest } from "../order/PaymentModal";
import type { Settled } from "../order/SettledModal";
import type { SplitOutcome } from "../order/SplitModal";
import { T } from "./tabletTheme";

// PAY on the tablet (Part 6g Step 5; 6g follow-up 1): the bill, then
//   - split it equally (2–10 ways) or by item — or pay it as one;
//   - a discount, only with a manager's PIN (the server insists on a tablet
//     and logs who approved it), on the desktop's rules;
//   - a tip for the waiter, when Settings › Restaurant › Payments asks for one;
//   - each part (or the bill) paid with cash, card and transfer mixed.
// Every figure is the server's (the bill, each part); lib/tender checks a
// payment adds up and the server checks it again as it settles. Refunds, and
// voids after payment, stay on the desktop POS.

type DiscountAsk = Omit<DiscountRequest, "approval">;
type Screen =
  | { kind: "bill" }
  | { kind: "split" }
  | { kind: "items"; guests: number; active: number; units: Units }
  | { kind: "discount"; type: "PERCENT" | "AMOUNT"; value: string; fresh: boolean; reason: string | null }
  | { kind: "approve"; request: DiscountAsk; approverId: string | null; pin: string; error: string | null }
  | { kind: "tip"; partId: string | null; label: string; due: string; amount: string; typing: boolean }
  | { kind: "pay"; partId: string | null; label: string; due: string; tip: string; rows: PayRow[]; active: number; fresh: boolean; key: string };

type Props = {
  title: string;
  bill: BillView;
  // The tip step (Settings › Restaurant › Payments), when the order has a waiter.
  tipsOn: boolean;
  // Who can approve a discount (Approve Discount, with a PIN).
  approvers: Approver[];
  busy: boolean;
  settled: Settled | null;
  onSettle: (request: SettleRequest) => Promise<SettleOutcome>;
  onSplit: (split: BillSplit) => Promise<SplitOutcome>;
  onOneBill: () => void;
  onDiscount: (request: DiscountRequest) => Promise<DiscountOutcome>;
  // After a part is paid and others are left: back to the bill.
  onNextPart: () => void;
  onDone: () => void;
  onClose: () => void;
};

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];
const PIN_PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLEAR", "0", "⌫"];
const naira = (value: string) => formatNaira(value || "0");
const btn = (extra: CSSProperties = {}): CSSProperties => ({ border: "none", borderRadius: 8, background: T.edge, color: T.text, fontWeight: 900, fontFamily: "inherit", cursor: "pointer", ...extra });

function Keypad({ onKey, data = "pay-key" }: { onKey: (key: string) => void; data?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: 72, gap: 8 }}>
      {PAD.map((k) => (
        <button key={k} type="button" className="tb-press" {...{ [`data-${data}`]: k }} onClick={() => onKey(k)} style={btn({ fontSize: 30, background: k === "⌫" ? T.button : T.buttonAlt })}>
          {k}
        </button>
      ))}
    </div>
  );
}

function Row({ label, value, strong, data }: { label: ReactNode; value: ReactNode; strong?: boolean; data?: string }) {
  return (
    <div {...(data ? { [`data-${data}`]: "" } : {})} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: strong ? 30 : 20, fontWeight: strong ? 900 : 700, color: strong ? T.text : T.soft }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function TabletPaySheet(props: Props) {
  const { bill, busy, settled } = props;
  const [screen, setScreen] = useState<Screen>({ kind: "bill" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cards = useMemo(() => buildCards(bill.lines), [bill.lines]);
  const open = billOpen(bill.split);
  const working = busy || pending;
  const go = (next: Screen) => {
    setMessage(null);
    setScreen(next);
  };

  // ---- Paying the bill or a part: the tip first (when asked), then how.
  function startPay(partId: string | null, label: string, due: string) {
    if (props.tipsOn && bill.order.hasWaiter) return go({ kind: "tip", partId, label, due, amount: "", typing: false });
    toPay(partId, label, due, "0");
  }
  function toPay(partId: string | null, label: string, due: string, tip: string) {
    const owed = new Decimal(due).plus(tip || "0").toFixed(2);
    go({ kind: "pay", partId, label, due, tip: tip || "0", rows: [{ paymentType: "CASH", amount: owed }], active: 0, fresh: true, key: newUuid() });
  }
  async function settle(s: Extract<Screen, { kind: "pay" }>) {
    const rows = s.rows.filter((r) => Number(r.amount || "0") > 0);
    if (working || !tender(s.due, s.tip, rows).ok) return;
    setPending(true);
    setMessage(null);
    const outcome = await props.onSettle({ ...(s.partId ? { partId: s.partId } : {}), payments: rows.map((r) => ({ paymentType: r.paymentType, amount: r.amount })), tip: s.tip, idempotencyKey: s.key });
    setPending(false);
    if (!outcome.ok) setMessage(outcome.error);
  }

  // ---- Split.
  async function split(request: BillSplit) {
    if (working) return;
    setPending(true);
    const outcome = await props.onSplit(request);
    setPending(false);
    if (outcome.ok) go({ kind: "bill" });
    else setMessage(outcome.error);
  }

  // ---- Discount: the manager's PIN on the 4th digit.
  async function approve(s: Extract<Screen, { kind: "approve" }>, pin: string) {
    if (!s.approverId) return;
    setPending(true);
    const outcome = await props.onDiscount({ ...s.request, approval: { approverId: s.approverId, pin } });
    setPending(false);
    if (outcome.ok) return go({ kind: "bill" });
    setScreen({ ...s, pin: "", error: outcome.error || "That PIN isn't right." });
  }
  function pinKey(s: Extract<Screen, { kind: "approve" }>, key: string) {
    if (working || !s.approverId) return;
    if (key === "CLEAR") return setScreen({ ...s, pin: "", error: null });
    if (key === "⌫") return setScreen({ ...s, pin: s.pin.slice(0, -1), error: null });
    const pin = (s.pin + key).slice(0, 4);
    setScreen({ ...s, pin, error: null });
    if (pin.length === 4) void approve(s, pin);
  }

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ fontSize: 30, fontWeight: 900, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Pay · {props.title}</span>
      <span data-pay-due style={{ fontSize: 38, fontWeight: 900, whiteSpace: "nowrap" }}>
        {bill.totals.total}
      </span>
    </div>
  );
  const alert = message && (
    <div role="alert" data-pay-message style={{ padding: "12px 16px", borderRadius: 8, background: "#3A1414", color: T.danger, fontSize: 19, fontWeight: 800 }}>
      {message}
    </div>
  );

  let body: ReactNode;
  if (settled) {
    body = (
      <div data-pay-done style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: T.ok }}>
          {settled.title === "Bill" ? "Paid" : `${settled.title} paid`} · {formatNaira(settled.paid)}
        </span>
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
        {settled.partsLeft > 0 ? (
          <button type="button" className="tb-press" data-pay-next onClick={() => (go({ kind: "bill" }), props.onNextPart())} style={btn({ height: 112, background: T.pay, fontSize: 30 })}>
            NEXT PART
          </button>
        ) : (
          <button type="button" className="tb-press" data-pay-finish onClick={props.onDone} style={btn({ height: 112, background: T.pay, fontSize: 30 })}>
            DONE
          </button>
        )}
      </div>
    );
  } else if (screen.kind === "bill") {
    const blocker = bill.settleBlocker;
    const stale = !!bill.split?.stale;
    body = (
      <>
        <div data-pay-sums style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 20px", borderRadius: 10, background: T.bg }}>
          <Row label="Subtotal" value={bill.totals.subTotal} />
          {bill.discount && <Row data="pay-discount-line" label={`Discount · ${bill.discount.label}${bill.discount.approvedBy ? ` (${bill.discount.approvedBy})` : ""}`} value={`−${bill.totals.discount}`} />}
          {bill.order.serviceCharge && <Row label={`Service ${bill.totals.servicePercent}`} value={bill.totals.serviceCharge} />}
          <Row label={bill.totals.taxLabel} value={bill.totals.tax} />
          <Row label="Total" value={bill.totals.total} strong />
        </div>
        {blocker && (
          <span data-pay-blocker style={{ fontSize: 19, fontWeight: 800, color: T.danger }}>
            {blocker}
          </span>
        )}
        {bill.split ? (
          <div data-pay-parts style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: T.quiet }}>{bill.split.modeLabel} · {bill.split.parts.length} parts</span>
            {stale && <span style={{ fontSize: 18, fontWeight: 800, color: T.danger }}>The bill changed after it was split: split it again or pay it as one.</span>}
            {bill.split.parts.map((part) => {
              const paid = part.status === "PAID";
              return (
                <button
                  key={part.id}
                  type="button"
                  className="tb-press"
                  data-pay-part={part.label}
                  data-paid={paid ? "" : undefined}
                  disabled={paid || stale || !!blocker || working}
                  onClick={() => startPay(part.id, part.label, part.amountValue)}
                  style={btn({ height: 84, padding: "0 22px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, background: paid ? T.bg : T.button, color: paid ? T.ok : T.text, opacity: stale || blocker ? 0.5 : 1 })}
                >
                  <span style={{ textAlign: "left" }}>
                    {part.label}
                    {part.items.length > 0 && <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: T.quiet }}>{part.items.map((i) => `${i.units}× ${i.name}`).join(", ")}</span>}
                  </span>
                  <span>{paid ? `PAID ✓ ${part.amount}` : `PAY ${part.amount}`}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <button type="button" className="tb-press" data-pay-whole disabled={!!blocker || working} onClick={() => startPay(null, "Bill", bill.totals.totalValue)} style={btn({ height: 112, background: T.pay, fontSize: 32, opacity: blocker ? 0.45 : 1 })}>
            PAY {bill.totals.total}
          </button>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <button type="button" className="tb-press" data-pay-cancel onClick={props.onClose} style={btn({ height: 84, background: "#000", color: T.lockFg, fontSize: 21 })}>
            CLOSE
          </button>
          {bill.split && open ? (
            <button type="button" className="tb-press" data-pay-one-bill disabled={working} onClick={props.onOneBill} style={btn({ height: 84, fontSize: 21 })}>
              ONE BILL
            </button>
          ) : (
            <button type="button" className="tb-press" data-pay-split disabled={!open || working || cards.length === 0} onClick={() => go({ kind: "split" })} style={btn({ height: 84, fontSize: 21, opacity: open ? 1 : 0.4 })}>
              SPLIT
            </button>
          )}
          <button
            type="button"
            className="tb-press"
            data-pay-discount
            disabled={!open || working}
            onClick={() => go({ kind: "discount", type: bill.discount?.type ?? "PERCENT", value: bill.discount?.value ?? "", fresh: true, reason: bill.discount?.reason || null })}
            style={btn({ height: 84, fontSize: 21, opacity: open ? 1 : 0.4 })}
          >
            DISCOUNT
          </button>
        </div>
        {bill.split && !open && <span style={{ fontSize: 16, fontWeight: 700, color: T.quiet }}>Part of the bill is paid: the split and discount stay as they are.</span>}
      </>
    );
  } else if (screen.kind === "split") {
    body = (
      <>
        <span style={{ fontSize: 24, fontWeight: 900 }}>Split equally</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gridAutoRows: 84, gap: 8 }}>
          {TABLET_SPLIT_WAYS.map((n) => (
            <button key={n} type="button" className="tb-press" data-split-ways={n} disabled={working} onClick={() => void split({ mode: "EQUAL", ways: n })} style={btn({ fontSize: 30 })}>
              {n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tb-press"
          data-split-items
          onClick={() => {
            const guests = Math.min(Math.max(bill.order.guests, 2), TABLET_MAX_GUESTS);
            go({ kind: "items", guests, active: 1, units: emptyUnits(cards) });
          }}
          style={btn({ height: 96, fontSize: 24, background: T.teal })}
        >
          BY ITEM — who pays for what
        </button>
        <button type="button" className="tb-press" onClick={() => go({ kind: "bill" })} style={btn({ height: 76, fontSize: 20, background: "#000", color: T.soft })}>
          BACK
        </button>
      </>
    );
  } else if (screen.kind === "items") {
    const s = screen;
    const ids = Array.from({ length: s.guests }, (_, i) => i + 1);
    const left = unassigned(s.units, cards).count;
    const has = (g: number) => Object.values(s.units).some((u) => u.some((x) => !!x && x.length === 1 && x[0] === g));
    const ready = left === 0 && ids.every(has);
    body = (
      <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {ids.map((g) => (
            <button key={g} type="button" className="tb-press" data-guest={g} aria-pressed={s.active === g} onClick={() => setScreen({ ...s, active: g })} style={btn({ height: 64, padding: "0 18px", fontSize: 20, background: s.active === g ? T.text : T.button, color: s.active === g ? "#000" : T.text })}>
              Guest {g}
            </button>
          ))}
          {s.guests < TABLET_MAX_GUESTS && (
            <button type="button" className="tb-press" data-guest-add onClick={() => setScreen({ ...s, guests: s.guests + 1 })} style={btn({ height: 64, width: 64, fontSize: 28 })}>
              +
            </button>
          )}
          {s.guests > 2 && (
            <button type="button" className="tb-press" data-guest-remove onClick={() => setScreen({ ...s, guests: s.guests - 1, active: Math.min(s.active, s.guests - 1), units: removeGuest(s.units, s.guests) })} style={btn({ height: 64, width: 64, fontSize: 28 })}>
              −
            </button>
          )}
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.quiet }}>Tap a dish to give one to Guest {s.active}; − gives it back.</span>
        <div data-split-cards style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cards.map((card) => {
            const units = s.units[card.key] ?? [];
            const mine = units.filter((u) => !!u && u.length === 1 && u[0] === s.active).length;
            const who = ids.map((g) => [g, units.filter((u) => !!u && u.length === 1 && u[0] === g).length] as const).filter(([, n]) => n > 0);
            const free = units.filter((u) => !u).length;
            return (
              <div key={card.key} style={{ display: "grid", gridTemplateColumns: "1fr 84px", gap: 8 }}>
                <button
                  type="button"
                  className="tb-press"
                  data-split-card={card.name}
                  onClick={() => {
                    const next = assignUnit(s.units, card.key, s.active);
                    if (!next) return setMessage(`Every ${card.name} has someone paying for it.`);
                    setMessage(null);
                    setScreen({ ...s, units: next });
                  }}
                  style={btn({ minHeight: 76, padding: "10px 18px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, textAlign: "left", background: mine ? T.teal : T.button })}
                >
                  <span style={{ fontSize: 21 }}>
                    {card.qty}× {card.name}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: T.soft }}>
                    {[card.detail, ...who.map(([g, n]) => `G${g}×${n}`), free ? `${free} left` : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <button
                  type="button"
                  className="tb-press"
                  data-split-less={card.name}
                  disabled={mine === 0}
                  onClick={() => {
                    const index = units.findIndex((u) => !!u && u.length === 1 && u[0] === s.active);
                    if (index >= 0) setScreen({ ...s, units: returnUnit(s.units, card.key, index, s.active) });
                  }}
                  style={btn({ fontSize: 30, opacity: mine ? 1 : 0.35 })}
                >
                  −
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 10 }}>
          <button type="button" className="tb-press" onClick={() => go({ kind: "split" })} style={btn({ height: 84, fontSize: 20, background: "#000", color: T.soft })}>
            BACK
          </button>
          <button type="button" className="tb-press" data-split-rest disabled={left === 0} onClick={() => setScreen({ ...s, units: restTo(s.units, s.active).units })} style={btn({ height: 84, fontSize: 17, opacity: left ? 1 : 0.4 })}>
            REST TO G{s.active}
          </button>
          <button type="button" className="tb-press" data-split-confirm disabled={!ready || working} onClick={() => void split({ mode: "ITEMS", parts: toParts(s.units, cards, ids) })} style={btn({ height: 84, fontSize: 22, background: T.teal, opacity: ready ? 1 : 0.45 })}>
            {left ? `${left} LEFT TO GIVE` : ids.every(has) ? `SPLIT ${s.guests} WAYS` : "EVERY GUEST NEEDS A DISH"}
          </button>
        </div>
      </>
    );
  } else if (screen.kind === "discount") {
    const s = screen;
    const n = Number(s.value || "0");
    const valid = n > 0 && (s.type === "AMOUNT" || n <= 100) && !!s.reason;
    body = (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {(["PERCENT", "AMOUNT"] as const).map((t) => (
            <button key={t} type="button" className="tb-press" data-discount-type={t} aria-pressed={s.type === t} onClick={() => setScreen({ ...s, type: t, value: "", fresh: true })} style={btn({ height: 72, fontSize: 22, background: s.type === t ? T.text : T.button, color: s.type === t ? "#000" : T.text })}>
              {t === "PERCENT" ? "% OFF" : "₦ OFF"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 20px", borderRadius: 10, background: T.bg }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.quiet }}>Discount</span>
          <span data-discount-value style={{ fontSize: 40, fontWeight: 900 }}>
            {s.type === "PERCENT" ? `${s.value || "0"}%` : naira(s.value)}
          </span>
        </div>
        {s.type === "PERCENT" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            {[5, 10, 15, 20].map((p) => (
              <button key={p} type="button" className="tb-press" data-discount-quick={p} onClick={() => setScreen({ ...s, value: String(p), fresh: true })} style={btn({ height: 64, fontSize: 21 })}>
                {p}%
              </button>
            ))}
          </div>
        )}
        <Keypad data="discount-key" onKey={(k) => setScreen({ ...s, value: keyed(s.value, k, s.fresh), fresh: false })} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TABLET_DISCOUNT_REASONS.map((r) => (
            <button key={r} type="button" className="tb-press" data-discount-reason={r} aria-pressed={s.reason === r} onClick={() => setScreen({ ...s, reason: r })} style={btn({ height: 60, padding: "0 16px", fontSize: 18, background: s.reason === r ? T.teal : T.button })}>
              {r}
            </button>
          ))}
        </div>
        {s.type === "PERCENT" && n > 100 && <span style={{ fontSize: 18, fontWeight: 800, color: T.danger }}>A percentage can&apos;t be more than 100.</span>}
        <div style={{ display: "grid", gridTemplateColumns: bill.discount ? "1fr 1fr 2fr" : "1fr 2fr", gap: 10 }}>
          <button type="button" className="tb-press" onClick={() => go({ kind: "bill" })} style={btn({ height: 84, fontSize: 20, background: "#000", color: T.soft })}>
            BACK
          </button>
          {bill.discount && (
            <button type="button" className="tb-press" data-discount-remove onClick={() => go({ kind: "approve", request: { type: bill.discount?.type ?? "PERCENT", value: "0", reason: "" }, approverId: props.approvers[0]?.id ?? null, pin: "", error: null })} style={btn({ height: 84, fontSize: 18 })}>
              REMOVE
            </button>
          )}
          <button
            type="button"
            className="tb-press"
            data-discount-ask
            disabled={!valid}
            onClick={() => s.reason && go({ kind: "approve", request: { type: s.type, value: String(n), reason: s.reason }, approverId: props.approvers[0]?.id ?? null, pin: "", error: null })}
            style={btn({ height: 84, fontSize: 21, background: T.teal, opacity: valid ? 1 : 0.45 })}
          >
            ASK A MANAGER
          </button>
        </div>
      </>
    );
  } else if (screen.kind === "approve") {
    const s = screen;
    const what = Number(s.request.value) === 0 ? "remove the discount" : s.request.type === "PERCENT" ? `${s.request.value}% off` : `${naira(s.request.value)} off`;
    body = (
      <div data-manager-pin style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <span style={{ fontSize: 24, fontWeight: 900 }}>A manager&apos;s PIN to {what}</span>
        {props.approvers.length === 0 ? (
          <span style={{ fontSize: 18, fontWeight: 700, color: T.danger }}>No one who can approve discounts has a PIN yet (an Administrator sets them on Settings › Staff).</span>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {props.approvers.map((a) => (
              <button key={a.id} type="button" className="tb-press" data-approver={a.name} aria-pressed={s.approverId === a.id} onClick={() => setScreen({ ...s, approverId: a.id, pin: "", error: null })} style={btn({ height: 64, padding: "0 20px", fontSize: 19, background: s.approverId === a.id ? T.teal : T.button })}>
                {a.name}
              </button>
            ))}
          </div>
        )}
        <div data-manager-dots={s.pin.length} style={{ display: "flex", gap: 22, justifyContent: "center", margin: "6px 0" }}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ width: 30, height: 30, borderRadius: "50%", boxSizing: "border-box", border: `4px solid ${s.error ? T.danger : T.text}`, background: s.error ? T.danger : i < s.pin.length ? T.text : "transparent" }} />
          ))}
        </div>
        <span data-manager-error role="alert" style={{ minHeight: 24, textAlign: "center", fontSize: 18, fontWeight: 800, color: T.danger }}>
          {s.error ?? ""}
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridAutoRows: 80, gap: 8 }}>
          {PIN_PAD.map((k) => (
            <button key={k} type="button" className="tb-press" data-manager-key={k} disabled={!s.approverId || working} onClick={() => pinKey(s, k)} style={btn({ fontSize: k === "CLEAR" ? 20 : 34, background: k === "CLEAR" || k === "⌫" ? T.button : T.buttonAlt })}>
              {k}
            </button>
          ))}
        </div>
        <button type="button" className="tb-press" onClick={() => go({ kind: "bill" })} style={btn({ height: 76, fontSize: 20, background: "#000", color: T.soft })}>
          CANCEL
        </button>
      </div>
    );
  } else if (screen.kind === "tip") {
    const s = screen;
    body = (
      <>
        <span style={{ fontSize: 24, fontWeight: 900 }}>
          A tip for {bill.order.waiter}? <span style={{ color: T.quiet, fontWeight: 700 }}>· {s.label} {naira(s.due)}</span>
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridAutoRows: 96, gap: 10 }}>
          <button type="button" className="tb-press" data-tip="0" onClick={() => toPay(s.partId, s.label, s.due, "0")} style={btn({ fontSize: 22 })}>
            NO TIP
          </button>
          {TIP_PERCENTS.map((p) => (
            <button key={p} type="button" className="tb-press" data-tip={p} onClick={() => toPay(s.partId, s.label, s.due, tipFor(s.due, p))} style={btn({ fontSize: 22, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 })}>
              <span>{p}%</span>
              <span style={{ fontSize: 16, color: T.soft }}>{naira(tipFor(s.due, p))}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "14px 20px", borderRadius: 10, background: T.bg }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.quiet }}>Or an amount</span>
          <span data-tip-amount style={{ fontSize: 36, fontWeight: 900 }}>
            {naira(s.amount)}
          </span>
        </div>
        <Keypad data="tip-key" onKey={(k) => setScreen({ ...s, amount: keyed(s.amount, k, !s.typing), typing: true })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button type="button" className="tb-press" onClick={() => go({ kind: "bill" })} style={btn({ height: 84, fontSize: 20, background: "#000", color: T.soft })}>
            BACK
          </button>
          <button type="button" className="tb-press" data-tip-next disabled={!Number(s.amount)} onClick={() => toPay(s.partId, s.label, s.due, Number(s.amount).toFixed(2))} style={btn({ height: 84, fontSize: 22, background: T.teal, opacity: Number(s.amount) ? 1 : 0.45 })}>
            TIP {naira(s.amount)} ›
          </button>
        </div>
      </>
    );
  } else {
    const s = screen;
    const owed = new Decimal(s.due).plus(s.tip).toFixed(2);
    const rows = s.rows.filter((r) => Number(r.amount || "0") > 0);
    const result = tender(s.due, s.tip, rows);
    const active = s.rows[s.active];
    const rowLeft = leftFor(owed, s.rows, s.active);
    const setRows = (next: PayRow[], index = s.active, fresh = true) => setScreen({ ...s, rows: next, active: index, fresh });
    body = (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: T.quiet }}>
            {s.label}
            {Number(s.tip) > 0 ? ` + tip ${naira(s.tip)}` : ""}
          </span>
          <span data-pay-owed style={{ fontSize: 34, fontWeight: 900 }}>
            {naira(owed)}
          </span>
        </div>
        <div data-pay-rows style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {s.rows.map((row, i) => (
            <div key={row.paymentType} style={{ display: "grid", gridTemplateColumns: s.rows.length > 1 ? "1fr 72px" : "1fr", gap: 8 }}>
              <button type="button" className="tb-press" data-pay-row={row.paymentType} aria-pressed={i === s.active} onClick={() => setScreen({ ...s, active: i, fresh: true })} style={btn({ height: 72, padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, background: i === s.active ? T.text : T.button, color: i === s.active ? "#000" : T.text })}>
                <span>{TABLET_METHOD_LABEL[row.paymentType]}</span>
                <span>{naira(row.amount)}</span>
              </button>
              {s.rows.length > 1 && (
                <button type="button" className="tb-press" data-pay-row-remove={row.paymentType} onClick={() => setRows(s.rows.filter((_, j) => j !== i), 0)} style={btn({ fontSize: 26, background: "#000", color: T.lockFg })}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${TABLET_METHODS.length + 1}, minmax(0, 1fr))`, gap: 8 }}>
          {TABLET_METHODS.map((m: PaymentType) => (
            <button key={m} type="button" className="tb-press" data-pay-method={m} aria-pressed={active?.paymentType === m} onClick={() => setRows(setMethod(s.rows, s.active, m))} style={btn({ height: 72, fontSize: 19, background: active?.paymentType === m ? T.teal : T.edge })}>
              {TABLET_METHOD_LABEL[m]}
            </button>
          ))}
          <button
            type="button"
            className="tb-press"
            data-pay-add
            disabled={s.rows.length >= TABLET_METHODS.length}
            onClick={() => {
              const next = addMethod(owed, s.rows);
              if (next) setRows(next, next.length - 1);
            }}
            style={btn({ height: 72, fontSize: 17, opacity: s.rows.length < TABLET_METHODS.length ? 1 : 0.4 })}
          >
            + MIX
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${active?.paymentType === "CASH" ? quickCash(rowLeft).length + 1 : 1}, minmax(0, 1fr))`, gap: 8 }}>
          <button type="button" className="tb-press" data-quick-cash="exact" onClick={() => setRows(s.rows.map((r, i) => (i === s.active ? { ...r, amount: rowLeft } : r)))} style={btn({ height: 68, fontSize: 19 })}>
            EXACT {naira(rowLeft)}
          </button>
          {active?.paymentType === "CASH" &&
            quickCash(rowLeft).map((v) => (
              <button key={v.toFixed(0)} type="button" className="tb-press" data-quick-cash={v.toFixed(0)} onClick={() => setRows(s.rows.map((r, i) => (i === s.active ? { ...r, amount: v.toFixed(2) } : r)))} style={btn({ height: 68, fontSize: 19 })}>
                {formatNaira(v.toFixed(0)).replace(/\.00$/, "")}
              </button>
            ))}
        </div>
        <Keypad onKey={(k) => setRows(s.rows.map((r, i) => (i === s.active ? { ...r, amount: keyed(r.amount.replace(/\.00$/, ""), k, s.fresh) } : r)), s.active, false)} />
        <span data-pay-status style={{ minHeight: 30, fontSize: 21, fontWeight: 800, color: result.ok ? T.ok : T.danger }}>
          {result.ok ? (result.change.greaterThan(0) ? `Change ${formatNaira(result.change.toFixed(2))}` : "Paid in full") : result.error}
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button type="button" className="tb-press" data-pay-back disabled={working} onClick={() => go({ kind: "bill" })} style={btn({ height: 112, background: "#000", color: T.lockFg, fontSize: 24 })}>
            BACK
          </button>
          <button type="button" className="tb-press" data-pay-settle disabled={!result.ok || working} onClick={() => void settle(s)} style={btn({ height: 112, background: T.pay, fontSize: 30, opacity: result.ok && !working ? 1 : 0.45 })}>
            {pending ? "SETTLING…" : "SETTLE"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 35, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" data-pay-sheet data-pay-screen={settled ? "done" : screen.kind} style={{ width: "100%", maxHeight: "96%", overflowY: "auto", background: T.raised, borderRadius: "18px 18px 0 0", padding: "24px 24px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
        {header}
        {alert}
        {body}
      </div>
    </div>
  );
}
