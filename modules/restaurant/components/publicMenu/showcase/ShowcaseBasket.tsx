"use client";

import { useEffect, useRef, useState } from "react";
import { GUEST_LINE_QTY_MAX, GUEST_NAME_MAX, type BasketLine, type GuestMode, type GuestOrderLineView, type GuestStage, type GuestWhere } from "../../../lib/guestOrdering";
import { MENU_STRINGS } from "../../../lib/menuStrings";
import type { PublicMenuItem } from "../../../lib/publicMenu";
import { TRACK_STAGES, trackerStep } from "../../../lib/showcaseMenu";
import { basketStore } from "../basketStore";
import { menuMoney } from "../menuMoney";
import css from "./showcase.module.css";

// The guest's order in the Showcase menu, a cream sheet from the bottom:
// the tracker (Waiting for waiter → Sent to kitchen → Preparing → Ready to
// serve) while anything sent is underway, what's not sent yet (how many,
// its options and note, what it comes to) with Send to waiter, then what
// this phone has sent and where each line is. Paying stays with the staff.
// At a QR point the guest gives a name for the order (kept on the phone).

const S = MENU_STRINGS;
const T = MENU_STRINGS.showcase;

const STAGE_COLOUR: Record<GuestStage, string> = {
  waiting: "#B4561F",
  sent: "#2457a6",
  preparing: "#B4561F",
  ready: "#2E7D4F",
  served: "#2E7D4F",
  rejected: "#b3261e",
  cancelled: "#6B5E51",
};

const NAME_KEY = "ringz.menu.name";
function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

type Props = {
  token: string;
  items: PublicMenuItem[];
  basket: BasketLine[];
  sent: GuestOrderLineView[];
  mode: GuestMode;
  where: GuestWhere;
  paused: boolean;
  onSent: (message: string) => void;
  onClose: () => void;
};

export default function ShowcaseBasket({ token, items, basket, sent, mode, where, paused, onSent, onClose }: Props) {
  const atPoint = where !== "table";
  const [name, setName] = useState(storedName);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ text: string; productId: string | null } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const byId = new Map(items.map((i) => [i.id, i]));

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const priced = basket.map((line) => {
    const item = byId.get(line.productId);
    const options = item ? item.modifiers.flatMap((g) => g.options).filter((o) => line.modifierIds.includes(o.id)) : [];
    const unit = item?.kobo == null ? null : item.kobo + options.reduce((sum, o) => sum + (o.kobo ?? 0), 0);
    return { line, item, options, amount: unit === null ? null : unit * line.quantity };
  });
  const sample = items.find((i) => i.price)?.price ?? null;
  const total = priced.every((p) => p.amount !== null) ? priced.reduce((sum, p) => sum + (p.amount ?? 0), 0) : null;
  const gone = priced.some((p) => !p.item);
  const needsName = atPoint && !name.trim();
  const step = trackerStep(sent.map((l) => l.stage));
  const off = sending || paused || gone || needsName;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/menu/${encodeURIComponent(token)}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: basket.map(({ productId, modifierIds, note, quantity }) => ({ productId, modifierIds, note, quantity })), ...(atPoint ? { name: name.trim() } : {}) }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as { ok: boolean; mode?: GuestMode; error?: string; productId?: string } | null;
      if (body?.ok) {
        basketStore.clear(token);
        if (atPoint) {
          try {
            localStorage.setItem(NAME_KEY, name.trim());
          } catch {}
        }
        onSent(body.mode === "auto" ? S.sentKitchen : body.mode === "direct" ? (atPoint ? S.sentPoint : S.sentDirect) : atPoint ? S.sentPoint : S.sentConfirm);
      } else {
        setError({ text: body?.error ?? S.sendFailed, productId: body?.productId ?? null });
      }
    } catch {
      setError({ text: S.sendFailed, productId: null });
    } finally {
      setSending(false);
    }
  }

  const payNote = where === "takeaway" ? S.payAtCounter : where === "bar" ? S.payAtBar : S.payWithStaff;
  return (
    <div className={css.scrim} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={S.yourOrder} data-basket-sheet className={css.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={css.sheetHead}>
          <h2 className={css.sheetTitle}>{basket.length ? S.yourOrder : T.orderStatus}</h2>
          <button ref={close} type="button" aria-label={S.close} data-basket-close className={css.sheetClose} onClick={onClose}>
            ×
          </button>
        </div>

        {step >= 0 && (
          <ol className={css.tracker} data-tracker={TRACK_STAGES[step]}>
            {TRACK_STAGES.map((stage, i) => (
              <li key={stage} className={css.trackStep} data-done={i <= step} aria-current={i === step ? "step" : undefined}>
                <span className={css.trackDot} aria-hidden>
                  {i < step ? "✓" : i === step ? "•" : ""}
                </span>
                {stage === "waiting" && atPoint ? T.trackPoint : T.track[stage]}
              </li>
            ))}
          </ol>
        )}

        <div className={css.sheetBody}>
          {basket.length > 0 && (
            <section aria-label={S.basket} data-basket>
              {sent.length > 0 && <h3 className={css.basketHeading}>{T.notSentYet}</h3>}
              {priced.map(({ line, item, options, amount }) => {
                const flagged = error?.productId === line.productId || !item;
                const mods = [...options.map((o) => o.name), ...(line.note ? [`“${line.note}”`] : [])].join(" · ");
                return (
                  <div key={line.key} className={css.bLine} data-basket-line={item?.name ?? line.productId} data-problem={flagged ? "" : undefined}>
                    <div className={css.bInfo}>
                      <span className={css.bName}>{item?.name ?? S.unavailable}</span>
                      {mods && <span className={css.bMods}>{mods}</span>}
                      <span className={css.bStatus} style={{ color: "#B4561F" }}>
                        {T.notSentYet}
                      </span>
                    </div>
                    <div className={css.bStepper} role="group" aria-label={S.quantity}>
                      <button type="button" className={css.bStep} aria-label={line.quantity === 1 ? S.remove : S.less} data-basket-less onClick={() => basketStore.setQuantity(token, line.key, line.quantity - 1)}>
                        −
                      </button>
                      <span className={css.bQty} data-basket-qty>
                        {line.quantity}
                      </span>
                      <button type="button" className={css.bStep} aria-label={S.more} data-basket-more disabled={line.quantity >= GUEST_LINE_QTY_MAX} onClick={() => basketStore.setQuantity(token, line.key, line.quantity + 1)}>
                        +
                      </button>
                    </div>
                    <span className={css.bAmount} data-basket-amount>
                      {amount !== null ? menuMoney(amount, sample) : ""}
                    </span>
                  </div>
                );
              })}
            </section>
          )}

          {sent.length > 0 && (
            <section aria-label={S.sent} data-guest-sent>
              <h3 className={css.basketHeading}>{S.sent}</h3>
              {sent.map((line) => (
                <div key={line.id} className={css.bLine} data-guest-line={line.name} data-stage={line.stage}>
                  <div className={css.bInfo}>
                    <span className={css.bName} style={{ textDecoration: line.stage === "cancelled" || line.stage === "rejected" ? "line-through" : "none" }}>
                      {line.quantity}× {line.name}
                    </span>
                    {line.detail && <span className={css.bMods}>{line.detail}</span>}
                    <span data-guest-stage className={css.bStatus} style={{ color: STAGE_COLOUR[line.stage] }}>
                      {line.stage === "waiting" && atPoint ? S.waitingForStaff : S.stage[line.stage]}
                    </span>
                  </div>
                  {line.amount && <span className={`${css.bAmount} ${css.bAmountQuiet}`}>{line.amount}</span>}
                </div>
              ))}
            </section>
          )}
          {basket.length === 0 && sent.length === 0 && (
            <p data-basket-empty className={css.small} style={{ padding: "20px 0", textAlign: "left" }}>
              {S.basketEmpty}
            </p>
          )}
        </div>

        <div className={css.sheetFoot}>
          {basket.length > 0 && total !== null && (
            <div className={css.totalRow}>
              <span className={css.totalLabel}>{S.total}</span>
              <span className={css.totalValue} data-basket-total>
                {menuMoney(total, sample)}
              </span>
            </div>
          )}
          {basket.length > 0 && atPoint && (
            <label className={css.nameField}>
              <span className={css.nameLabel}>{S.nameLabel}</span>
              <input data-basket-name className={css.nameInput} value={name} maxLength={GUEST_NAME_MAX} placeholder={S.namePlaceholder} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
              {where === "takeaway" && <span className={css.small} style={{ textAlign: "left" }}>{S.nameHelp}</span>}
            </label>
          )}
          {basket.length > 0 && (error || paused) && (
            <p data-basket-error role="alert" className={css.error}>
              {paused ? S.orderingPaused : error?.text}
            </p>
          )}
          {basket.length > 0 && (
            <button type="button" data-basket-send className={css.send} disabled={off} onClick={() => void send()}>
              {sending ? S.sending : mode === "auto" ? S.sendToKitchen : atPoint ? S.sendOrder : S.sendToWaiter}
            </button>
          )}
          <p className={css.small} data-pay-note>
            {basket.length > 0 && mode === "confirm" ? `${atPoint ? T.pointNote : T.confirmNote} ` : ""}
            {payNote}
            {basket.length > 0 ? ` ${S.estimateNote}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
