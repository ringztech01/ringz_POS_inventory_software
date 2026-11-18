"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { GUEST_LINE_QTY_MAX, GUEST_NAME_MAX, GUEST_NOTE_MAX, type BasketLine, type GuestMode, type GuestOrderLineView, type GuestStage, type GuestWhere } from "../../lib/guestOrdering";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import type { PublicMenuItem } from "../../lib/publicMenu";
import { basketStore } from "./basketStore";
import { menuMoney } from "./menuMoney";

// The guest's order (Part 8 Step 7), a full-screen sheet: what's not sent
// yet (each line's options, how many, a note, what it comes to) with Send
// to waiter, then what this phone has sent and where each line is —
// Waiting for waiter → Sent to kitchen → Preparing → Ready → Served. Never
// who. Paying stays with the staff. At a QR point (Step 8) the guest gives
// a name for the order (kept on the phone for next time).

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INK = "#171b1c";
const QUIET = "#6d777a";
const LINE = "#eceff0";

const STAGE_COLOUR: Record<GuestStage, [string, string]> = {
  waiting: ["#fdf2e9", "#9a4a12"],
  sent: ["#e8effa", "#2457a6"],
  preparing: ["#fdf0e3", "#b2541a"],
  ready: ["#e7f4f1", "#0a6355"],
  served: ["#eaf6ee", "#13804a"],
  rejected: ["#fbeaea", "#b3261e"],
  cancelled: ["#f1f4f4", "#6d777a"],
};

type Props = {
  token: string;
  items: PublicMenuItem[];
  basket: BasketLine[];
  sent: GuestOrderLineView[];
  mode: GuestMode;
  where: GuestWhere;
  paused: boolean;
  accent: string;
  onSent: (message: string) => void;
  onClose: () => void;
};

function NoteField({ line, onSave }: { line: BasketLine; onSave: (note: string) => void }) {
  const [value, setValue] = useState(line.note);
  return (
    <input
      data-basket-note
      aria-label={S.noteLabel}
      value={value}
      maxLength={GUEST_NOTE_MAX}
      placeholder={S.notePlaceholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() !== line.note && onSave(value.trim())}
      style={{ height: 36, border: "1px solid #dde2e3", borderRadius: 8, padding: "0 10px", fontSize: 13.5, fontFamily: FONT, color: INK, background: "#fff", width: "100%", boxSizing: "border-box", minWidth: 0 }}
    />
  );
}

const NAME_KEY = "ringz.menu.name";
function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function BasketSheet({ token, items, basket, sent, mode, where, paused, accent, onSent, onClose }: Props) {
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

  return (
    <div role="dialog" aria-modal="true" aria-label={S.yourOrder} data-basket-sheet style={{ position: "fixed", inset: 0, zIndex: 25, background: "#fafbfb", overflowY: "auto", WebkitOverflowScrolling: "touch", fontFamily: FONT, color: INK }}>
      <div style={{ maxWidth: 640, margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column" }}>
        <header style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          <button ref={close} type="button" aria-label={S.close} data-basket-close onClick={onClose} style={{ width: 38, height: 38, borderRadius: 19, border: "1px solid #dde2e3", background: "#fff", color: INK, fontSize: 22, lineHeight: "34px", cursor: "pointer" }}>
            ×
          </button>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{S.yourOrder}</h2>
        </header>

        <main style={{ flex: 1, padding: "8px 16px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <section aria-label={S.basket} data-basket style={{ display: "flex", flexDirection: "column" }}>
            <h3 style={{ margin: "10px 0 4px", fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: QUIET }}>{S.basket}</h3>
            {basket.length === 0 ? (
              <p data-basket-empty style={{ margin: "8px 0", fontSize: 14, color: QUIET }}>
                {S.basketEmpty}
              </p>
            ) : (
              priced.map(({ line, item, options, amount }) => {
                const flagged = error?.productId === line.productId;
                return (
                  <div key={line.key} data-basket-line={item?.name ?? line.productId} data-problem={flagged || !item ? "" : undefined} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderBottom: `1px solid ${LINE}` }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 15, fontWeight: 650, color: flagged || !item ? "#b3261e" : INK }}>{item?.name ?? S.unavailable}</span>
                        {options.length > 0 && <span style={{ fontSize: 12.5, color: QUIET }}>{options.map((o) => o.name).join(", ")}</span>}
                      </div>
                      {amount !== null && <span data-basket-amount style={{ fontSize: 14.5, fontWeight: 650, color: "#0a6355", whiteSpace: "nowrap" }}>{menuMoney(amount, sample)}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div role="group" aria-label={S.quantity} style={{ display: "flex", alignItems: "center", border: "1px solid #dde2e3", borderRadius: 10, height: 38, flexShrink: 0 }}>
                        <button type="button" aria-label={line.quantity === 1 ? S.remove : S.less} data-basket-less onClick={() => basketStore.setQuantity(token, line.key, line.quantity - 1)} style={{ width: 36, height: 36, border: "none", background: "none", color: INK, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {line.quantity === 1 ? <Trash2 size={16} aria-hidden /> : <Minus size={16} aria-hidden />}
                        </button>
                        <span data-basket-qty style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>
                          {line.quantity}
                        </span>
                        <button type="button" aria-label={S.more} data-basket-more disabled={line.quantity >= GUEST_LINE_QTY_MAX} onClick={() => basketStore.setQuantity(token, line.key, line.quantity + 1)} style={{ width: 36, height: 36, border: "none", background: "none", color: INK, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Plus size={16} aria-hidden />
                        </button>
                      </div>
                      <NoteField line={line} onSave={(note) => basketStore.setNote(token, line.key, note)} />
                    </div>
                  </div>
                );
              })
            )}
            {total !== null && basket.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 2px" }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{S.total}</span>
                <span data-basket-total style={{ fontSize: 18, fontWeight: 750 }}>
                  {menuMoney(total, sample)}
                </span>
              </div>
            )}
            {basket.length > 0 && <span style={{ fontSize: 12, color: QUIET }}>{S.estimateNote}</span>}
          </section>

          {sent.length > 0 && (
            <section aria-label={S.sent} data-guest-sent style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{ margin: "6px 0 4px", fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: QUIET }}>{S.sent}</h3>
              {sent.map((line) => {
                const [bg, fg] = STAGE_COLOUR[line.stage];
                return (
                  <div key={line.id} data-guest-line={line.name} data-stage={line.stage} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 0", borderBottom: `1px solid ${LINE}` }}>
                    <span style={{ fontWeight: 700, minWidth: 22 }}>{line.quantity}×</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, textDecoration: line.stage === "cancelled" || line.stage === "rejected" ? "line-through" : "none" }}>{line.name}</span>
                      {line.detail && <span style={{ fontSize: 12.5, color: QUIET }}>{line.detail}</span>}
                      <span data-guest-stage style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 9, background: bg, color: fg }}>
                        {line.stage === "waiting" && atPoint ? S.waitingForStaff : S.stage[line.stage]}
                      </span>
                    </div>
                    {line.amount && <span style={{ fontSize: 13.5, color: QUIET, whiteSpace: "nowrap" }}>{line.amount}</span>}
                  </div>
                );
              })}
              <span data-pay-note style={{ fontSize: 12, color: QUIET, marginTop: 8 }}>
                {where === "takeaway" ? S.payAtCounter : where === "bar" ? S.payAtBar : S.payWithStaff}
              </span>
            </section>
          )}
        </main>

        {basket.length > 0 && (
          <footer style={{ position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${LINE}`, padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8 }}>
            {atPoint && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{S.nameLabel}</span>
                <input
                  data-basket-name
                  value={name}
                  maxLength={GUEST_NAME_MAX}
                  placeholder={S.namePlaceholder}
                  autoComplete="given-name"
                  onChange={(e) => setName(e.target.value)}
                  style={{ height: 44, border: "1px solid #dde2e3", borderRadius: 10, padding: "0 12px", fontSize: 15, fontFamily: FONT, color: INK, background: "#fff" }}
                />
                <span style={{ fontSize: 12, color: QUIET }}>{where === "takeaway" ? `${S.nameHelp} ${S.payAtCounter}` : S.payAtBar}</span>
              </label>
            )}
            {(error || paused) && (
              <span data-basket-error role="alert" style={{ fontSize: 13, color: "#9a4a12" }}>
                {paused ? S.orderingPaused : error?.text}
              </span>
            )}
            <button
              type="button"
              data-basket-send
              disabled={sending || paused || gone || needsName}
              onClick={() => void send()}
              style={{ height: 52, border: "none", borderRadius: 12, background: sending || paused || gone || needsName ? "#c5cbcd" : accent, color: "#fff", fontFamily: FONT, fontSize: 16, fontWeight: 700, cursor: sending || paused || gone || needsName ? "default" : "pointer" }}
            >
              {sending ? S.sending : mode === "auto" ? S.sendToKitchen : atPoint ? S.sendOrder : S.sendToWaiter}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
