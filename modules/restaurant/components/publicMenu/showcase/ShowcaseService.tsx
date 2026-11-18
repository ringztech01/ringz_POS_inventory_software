"use client";

import { useEffect, useRef, useState } from "react";
import { MENU_STRINGS } from "../../../lib/menuStrings";
import type { GuestRequests, TableRequestType } from "../../../lib/tableRequests";
import css from "./showcase.module.css";

// Call waiter / Request bill in the Showcase menu: the Waiter button in the
// dock opens "How can we help?" with the switched-on buttons; a tap there
// sends it (opening the sheet was the first tap, so nothing goes by
// accident). While a request is outstanding the dock button says so —
// Waiter called, then Waiter coming — as the menu's live check reports it.

const S = MENU_STRINGS;
const T = MENU_STRINGS.showcase;

export function waiterLabel(requests: GuestRequests): string {
  if (requests.CALL_WAITER === "acknowledged") return T.waiterComing;
  if (requests.REQUEST_BILL === "acknowledged") return T.billComing;
  if (requests.CALL_WAITER === "open") return T.waiterCalled;
  if (requests.REQUEST_BILL === "open") return T.billAsked;
  return T.waiter;
}

const bell = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export function WaiterButton({ requests, onOpen }: { requests: GuestRequests; onOpen: () => void }) {
  const state = requests.CALL_WAITER === "acknowledged" || requests.REQUEST_BILL === "acknowledged" ? "acknowledged" : requests.CALL_WAITER || requests.REQUEST_BILL ? "open" : "none";
  return (
    <button type="button" data-service-open data-state={state} className={css.waiter} onClick={onOpen}>
      {bell}
      {waiterLabel(requests)}
    </button>
  );
}

export default function ShowcaseService({
  token,
  where,
  buttons,
  requests,
  onRequests,
  onClose,
  say,
}: {
  token: string;
  where: string;
  buttons: { callWaiter: boolean; requestBill: boolean };
  requests: GuestRequests;
  onRequests: (requests: GuestRequests) => void;
  onClose: () => void;
  say: (text: string) => void;
}) {
  const [sending, setSending] = useState<TableRequestType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(type: TableRequestType) {
    setSending(type);
    setError(null);
    try {
      const response = await fetch(`/menu/${encodeURIComponent(token)}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as { ok: boolean; error?: string; requests?: GuestRequests } | null;
      if (body?.ok && body.requests) {
        onRequests(body.requests);
        say(type === "CALL_WAITER" ? S.waiterCalled : S.billRequested);
        onClose();
      } else setError(body?.error ?? S.requestFailed);
    } catch {
      setError(S.requestFailed);
    } finally {
      setSending(null);
    }
  }

  const shown = ([buttons.callWaiter && "CALL_WAITER", buttons.requestBill && "REQUEST_BILL"] as const).filter((t): t is TableRequestType => !!t);
  return (
    <div className={css.scrim} onClick={() => !sending && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="showcase-help-title" data-service-sheet className={`${css.sheet} ${css.helpSheet}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 id="showcase-help-title" className={css.sheetTitle}>
            {T.howCanWeHelp}
          </h2>
          <span className={css.small} style={{ textAlign: "left" }}>
            {where} · {S.confirmHelp}
          </span>
        </div>
        <div className={css.helpGrid}>
          {shown.map((type) => {
            const state = requests[type];
            const call = type === "CALL_WAITER";
            const line = state === "open" ? S.waitingForWaiter : state === "acknowledged" ? (call ? S.waiterOnTheWay : S.billOnTheWay) : call ? T.callHelp : T.billHelp;
            return (
              <button
                key={type}
                type="button"
                data-service-button={type}
                data-service-send={type}
                data-state={state ?? "none"}
                disabled={!!state || !!sending}
                className={`${css.help} ${call ? css.helpDark : css.helpLight}`}
                onClick={() => void send(type)}
              >
                <span className={css.helpName}>{state ? (call ? S.waiterCalled : S.billRequested) : call ? S.callWaiter : S.requestBill}</span>
                <span className={css.helpLine} data-service-state>
                  {sending === type ? "…" : line}
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <p data-service-error role="alert" className={css.error}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
