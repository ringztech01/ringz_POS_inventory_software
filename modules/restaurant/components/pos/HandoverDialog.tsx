"use client";

import { useEffect, useState } from "react";
import { formatAppTime } from "../../lib/time";
import { TOUCH } from "../../lib/theme";
import type { Handover } from "../../server/services/shifts";
import TouchButton from "./TouchButton";

// Shift handover (Part 6f Step 7a): ending a shift with open tables, they go
// to another waiter first. The open tables on the left; who takes them on
// the right (whoever's on shift first). Esc goes back.
export default function HandoverDialog({ handover, busy, onHand, onClose }: { handover: Handover; busy: boolean; onHand: (toId: string) => void; onClose: () => void }) {
  const [to, setTo] = useState<string | null>(handover.to.find((p) => p.onShift)?.id ?? null);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);
  const taker = handover.to.find((p) => p.id === to);
  const n = handover.orders.length;

  return (
    <div role="dialog" aria-label="Hand over your tables" data-handover style={{ position: "fixed", inset: 0, zIndex: 225, background: TOUCH.scrim, color: TOUCH.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, lineHeight: "normal" }}>
      <div style={{ width: "min(960px, 100%)", maxHeight: "100%", background: TOUCH.header, borderRadius: TOUCH.radius, padding: 24, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", gap: 18, boxShadow: "0 20px 60px rgba(0,0,0,.45)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ margin: 0, fontFamily: TOUCH.display, fontSize: 26, fontWeight: 700 }}>Hand over your {n === 1 ? "table" : `${n} tables`}</h2>
          <span style={{ fontSize: 15, color: TOUCH.textDim }}>Before your shift ends, someone else takes {n === 1 ? "it" : "them"} — with every line and payment as they are.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18, minHeight: 0 }}>
          <section aria-label="Your open tables" style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.muted }}>YOUR OPEN TABLES</span>
            {handover.orders.map((o) => (
              <div key={o.id} data-handover-order={o.ref} style={{ background: TOUCH.key, borderRadius: TOUCH.radius, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                <span style={{ fontSize: 13, color: TOUCH.textDim, whiteSpace: "nowrap" }}>
                  {o.ref} · {o.guests} {o.guests === 1 ? "guest" : "guests"} · {o.lines} {o.lines === 1 ? "line" : "lines"} · since {formatAppTime(new Date(o.openedAt))}
                </span>
              </div>
            ))}
          </section>
          <section aria-label="Who takes them" style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.muted }}>WHO TAKES THEM</span>
            {handover.to.length === 0 ? (
              <span style={{ fontSize: 15, color: TOUCH.textDim }}>Nobody else takes orders. A manager can move them on the floor plan, or just lock and keep your shift open.</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {handover.to.map((p) => (
                  <TouchButton
                    key={p.id}
                    data-handover-to={p.name}
                    aria-pressed={to === p.id}
                    background={to === p.id ? TOUCH.teal : TOUCH.key}
                    color={to === p.id ? "#fff" : TOUCH.text}
                    onClick={() => setTo(p.id)}
                    style={{ height: 56, padding: "0 16px", fontSize: 15, fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2 }}
                  >
                    <span>{p.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.8 }}>{p.onShift ? "On shift" : "Not on shift"}</span>
                  </TouchButton>
                ))}
              </div>
            )}
          </section>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <TouchButton data-handover-cancel background={TOUCH.key} disabled={busy} onClick={onClose} style={{ height: 56, padding: "0 22px", fontSize: 16, fontWeight: 700 }}>
            Back
          </TouchButton>
          <TouchButton
            data-handover-go
            background={TOUCH.teal}
            color="#fff"
            disabled={busy || !taker}
            onClick={() => taker && onHand(taker.id)}
            style={{ height: 56, padding: "0 22px", fontSize: 16, fontWeight: 700, opacity: busy || !taker ? 0.5 : 1 }}
          >
            {busy ? "Handing over…" : taker ? `Give ${n === 1 ? "it" : "them"} to ${taker.name} · end shift` : "Pick who takes them"}
          </TouchButton>
        </div>
      </div>
    </div>
  );
}
