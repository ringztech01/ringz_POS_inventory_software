"use client";

import { useState } from "react";
import { Bell, Check, Receipt } from "lucide-react";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import type { GuestRequests, GuestRequestState, TableRequestType } from "../../lib/tableRequests";

// Call waiter / Request bill (Part 8 Step 6) in the dock along the bottom of
// a table's menu, each only when switched on. A tap asks first (no accidental calls),
// then the button says where the request stands — waiting, or a waiter's
// on the way — as the menu's live check reports it. Never who.

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INK = "#171b1c";
const QUIET = "#6d777a";

type Props = {
  token: string;
  // "Table 5".
  where: string;
  buttons: { callWaiter: boolean; requestBill: boolean };
  requests: GuestRequests;
  accent: string;
  onRequests: (requests: GuestRequests) => void;
};

function stateLine(type: TableRequestType, state: GuestRequestState): string | null {
  if (state === "open") return S.waitingForWaiter;
  if (state === "acknowledged") return type === "CALL_WAITER" ? S.waiterOnTheWay : S.billOnTheWay;
  return null;
}

export default function ServiceBar({ token, where, buttons, requests, accent, onRequests }: Props) {
  const [asking, setAsking] = useState<TableRequestType | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = ([buttons.callWaiter && "CALL_WAITER", buttons.requestBill && "REQUEST_BILL"] as const).filter((t): t is TableRequestType => !!t);

  async function send(type: TableRequestType) {
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/menu/${encodeURIComponent(token)}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as { ok: boolean; error?: string; requests?: GuestRequests } | null;
      if (body?.ok && body.requests) onRequests(body.requests);
      else setError(body?.error ?? S.requestFailed);
    } catch {
      setError(S.requestFailed);
    } finally {
      setSending(false);
      setAsking(null);
    }
  }

  return (
    <>
      <div data-service-bar style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {error && (
          <span data-service-error role="alert" style={{ fontSize: 12.5, color: "#9a4a12" }}>
            {error}
          </span>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {shown.map((type) => {
            const state = requests[type];
            const Icon = state ? Check : type === "CALL_WAITER" ? Bell : Receipt;
            const label = state ? (type === "CALL_WAITER" ? S.waiterCalled : S.billRequested) : type === "CALL_WAITER" ? S.callWaiter : S.requestBill;
            const line = stateLine(type, state);
            return (
              <button
                key={type}
                type="button"
                data-service-button={type}
                data-state={state ?? "none"}
                disabled={!!state || sending}
                onClick={() => {
                  setError(null);
                  setAsking(type);
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 50,
                  border: state ? `1px solid ${accent}` : "none",
                  borderRadius: 12,
                  background: state ? "#fff" : accent,
                  color: state ? accent : "#fff",
                  fontFamily: FONT,
                  fontSize: 15,
                  fontWeight: 700,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  padding: "4px 8px",
                  cursor: state ? "default" : "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon size={18} strokeWidth={2.2} aria-hidden />
                  {label}
                </span>
                {line && (
                  <span data-service-state style={{ fontSize: 11.5, fontWeight: 600, color: QUIET }}>
                    {line}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {asking && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-confirm-title"
          data-service-confirm={asking}
          onClick={() => !sending && setAsking(null)}
          style={{ position: "fixed", inset: 0, zIndex: 30, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ boxSizing: "border-box", width: "100%", maxWidth: 640, background: "#fff", borderRadius: "16px 16px 0 0", padding: "22px 20px calc(18px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 14, fontFamily: FONT, color: INK }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 id="service-confirm-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                {asking === "CALL_WAITER" ? S.confirmCall(where) : S.confirmBill(where)}
              </h2>
              <span style={{ fontSize: 13.5, color: QUIET }}>{S.confirmHelp}</span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                data-service-cancel
                disabled={sending}
                onClick={() => setAsking(null)}
                style={{ flex: 1, height: 50, border: "1px solid #dde2e3", borderRadius: 12, background: "#fff", color: INK, fontFamily: FONT, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
              >
                {S.cancel}
              </button>
              <button
                type="button"
                data-service-send
                disabled={sending}
                onClick={() => void send(asking)}
                style={{ flex: 1, height: 50, border: "none", borderRadius: 12, background: accent, color: "#fff", fontFamily: FONT, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: sending ? 0.7 : 1 }}
              >
                {asking === "CALL_WAITER" ? S.callWaiter : S.requestBill}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
