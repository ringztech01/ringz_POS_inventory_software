"use client";

import { useState } from "react";
import type { KitchenStatus } from "@prisma/client";
import { MoreVertical } from "lucide-react";
import { FONTS } from "@/components/layout/theme";
import { fmtElapsed, isLate, type KdsView, type KitchenStep } from "../../lib/kds";
import { KDS, KDS_STEP_PILL } from "../../lib/theme";
import type { KdsLine, KdsTicket } from "../../server/queries/kds";

// One ticket on the kitchen display (RingzPOS Kitchen Display design). The
// header turns teal when every line is Ready and red once the ticket is past
// its station's limit. Tap a line: one step forward; tap its pill: one step
// back. Read-only without Manage Kitchen. With Log Waste, a line being made
// or ready has a menu (⋯) with Remake.

const isStep = (status: KitchenStatus): status is KitchenStep => status === "PENDING" || status === "PREPARING" || status === "READY";
const finished = (status: KitchenStatus) => status === "READY" || status === "SERVED";

export default function TicketCard({
  ticket,
  view,
  now,
  canManage,
  canWaste,
  busy,
  statusOf,
  onAdvance,
  onRecallLine,
  onBump,
  onRecall,
  onRemake,
}: {
  ticket: KdsTicket;
  view: KdsView;
  now: number;
  canManage: boolean;
  // Log Waste: the line menu's Remake.
  canWaste: boolean;
  // A bump or recall of this ticket is on its way.
  busy: boolean;
  // The line's status as shown (the server's, or a tap not saved yet).
  statusOf: (line: KdsLine) => KitchenStatus;
  onAdvance: (line: KdsLine, from: KitchenStep) => void;
  onRecallLine: (line: KdsLine, from: KitchenStep) => void;
  onBump: () => void;
  onRecall: () => void;
  onRemake: (line: KdsLine) => void;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const done = ticket.lines.every((line) => finished(statusOf(line)));
  const late = view === "active" && !done && isLate(ticket.sentAt, ticket.station.lateAfterMin, now);
  const timer = view === "done" && ticket.bumpedAt ? fmtElapsed(ticket.sentAt, new Date(ticket.bumpedAt)) : fmtElapsed(ticket.sentAt, now);
  const printLabel = ticket.printCount > 0 ? `Reprint (${ticket.printCount})` : "Print KOT";

  return (
    <article
      aria-label={`${ticket.table} ${ticket.ref}`}
      data-ticket={ticket.ref}
      data-state={done ? "done" : late ? "late" : "open"}
      style={{
        background: KDS.card,
        border: `1px solid ${late ? KDS.lateBorder : KDS.divider}`,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ padding: "12px 14px", background: done ? KDS.teal : late ? KDS.lateHead : KDS.divider, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700 }}>{ticket.table}</span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {ticket.type} · {ticket.station.name}
          </span>
          <span style={{ fontSize: 11.5, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ticket.orderRef} · {ticket.ref} · {ticket.waiter}
          </span>
        </div>
        <span data-timer style={{ marginLeft: "auto", fontFamily: FONTS.mono, fontSize: 17, fontWeight: 600 }}>
          {timer}
        </span>
      </div>

      {ticket.note && (
        <div data-ticket-note style={{ padding: "6px 14px", background: "#3a2f14", color: KDS.note, fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em" }}>
          {ticket.note}
        </div>
      )}

      <div style={{ padding: "6px 14px", display: "flex", flexDirection: "column" }}>
        {ticket.lines.map((line) => {
          const status = statusOf(line);
          const step = isStep(status) ? status : null;
          const struck = finished(status);
          const canAdvance = canManage && (step === "PENDING" || step === "PREPARING");
          const canStepBack = canManage && (step === "PREPARING" || step === "READY");
          const [pillBg, pillFg] = step ? KDS_STEP_PILL[step] : [KDS.divider, KDS.muted];
          const canRemake = canWaste && view === "active" && (status === "PREPARING" || status === "READY");
          return (
            <div key={line.itemId} data-line={line.name} data-status={status} style={{ padding: "10px 0", borderBottom: `1px solid ${KDS.divider}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <button
                type="button"
                disabled={!canAdvance}
                aria-label={canAdvance ? `${line.name}: move to ${step === "PENDING" ? "Preparing" : "Ready"}` : line.name}
                onClick={() => step && onAdvance(line, step)}
                style={{ all: "unset", flex: 1, display: "flex", gap: 10, alignItems: "flex-start", cursor: canAdvance ? "pointer" : "default" }}
              >
                <span style={{ fontFamily: FONTS.mono, fontSize: 16, fontWeight: 600, minWidth: 28, textDecoration: struck ? "line-through" : "none", color: struck ? KDS.faint : KDS.qty }}>
                  {line.quantity}×
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, textDecoration: struck ? "line-through" : "none", color: struck ? KDS.faint : KDS.text }}>
                    {line.name}
                    {line.remake && (
                      <span data-remake style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 5, background: "#3a2f14", color: KDS.note, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textDecoration: "none", display: "inline-block" }}>
                        REMAKE
                      </span>
                    )}
                  </span>
                  {line.modifiers && <span style={{ fontSize: 12.5, color: KDS.soft }}>{line.modifiers}</span>}
                  {line.note && <span style={{ fontSize: 12.5, color: KDS.note }}>{line.note}</span>}
                </span>
              </button>
              <button
                type="button"
                disabled={!canStepBack}
                aria-label={canStepBack ? `${line.name}: back to ${step === "READY" ? "Preparing" : "Pending"}` : `${line.name}: ${status.toLowerCase()}`}
                onClick={() => step && onRecallLine(line, step)}
                style={{
                  height: 22,
                  padding: "0 8px",
                  border: "none",
                  borderRadius: 11,
                  background: pillBg,
                  color: pillFg,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  display: "flex",
                  alignItems: "center",
                  cursor: canStepBack ? "pointer" : "default",
                  flexShrink: 0,
                }}
              >
                {status}
              </button>
              {canRemake && (
                <span style={{ position: "relative", flexShrink: 0, marginTop: -11 }}>
                  <button
                    type="button"
                    aria-label={`${line.name}: more`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === line.itemId}
                    onClick={() => setMenuFor(menuFor === line.itemId ? null : line.itemId)}
                    style={{ width: 44, height: 44, border: "none", borderRadius: 8, background: menuFor === line.itemId ? KDS.divider : "transparent", color: KDS.soft, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  >
                    <MoreVertical size={18} strokeWidth={2} />
                  </button>
                  {menuFor === line.itemId && (
                    <>
                      {/* A click anywhere else closes the menu. */}
                      <span onClick={() => setMenuFor(null)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
                      <span role="menu" style={{ position: "absolute", right: 0, top: 46, zIndex: 11, minWidth: 180, padding: 4, borderRadius: 10, background: KDS.header, border: `1px solid ${KDS.buttonBorder}`, boxShadow: "0 10px 24px rgba(0,0,0,.5)" }}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuFor(null);
                            onRemake(line);
                          }}
                          style={{ width: "100%", height: 44, border: "none", borderRadius: 7, background: "transparent", color: KDS.text, fontSize: 14, fontWeight: 600, textAlign: "left", padding: "0 12px", cursor: "pointer" }}
                        >
                          Remake…
                        </button>
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
        {ticket.cancelledCount > 0 && (
          <span style={{ padding: "8px 0 2px", fontSize: 12, color: KDS.faint }}>
            {ticket.cancelledCount} cancelled {ticket.cancelledCount === 1 ? "line" : "lines"} (VOID sent)
          </span>
        )}
      </div>

      <div style={{ marginTop: "auto", padding: "12px 14px", display: "grid", gridTemplateColumns: canManage ? "1fr 1fr" : "1fr", gap: 8 }}>
        <a
          href={`/restaurant/kot/${ticket.id}?autoprint=1`}
          target="_blank"
          rel="noopener"
          style={{ height: 40, border: `1px solid ${KDS.buttonBorder}`, background: "transparent", color: KDS.text, borderRadius: 8, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
        >
          {printLabel}
        </a>
        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={view === "done" ? onRecall : onBump}
            style={{ height: 40, border: "none", background: KDS.teal, color: "#fff", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}
          >
            {view === "done" ? "Recall" : "All ready"}
          </button>
        )}
      </div>
    </article>
  );
}
