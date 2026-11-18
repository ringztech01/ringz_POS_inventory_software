"use client";

import { Check, ShoppingBag, X } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { TOUCH } from "../../lib/theme";
import type { PendingGuestLine } from "../../lib/guestOrdering";

// A guest's lines from the table's menu waiting for a waiter (Part 8 Step
// 7), on both order screens — the touch POS's check (`touch`) and the
// dashboard's ticket — in their own colour, apart from the order's lines:
// they're not on the bill or the kitchen's screen until confirmed. Confirm
// makes them ordinary New lines (sent as usual); Reject turns them down and
// the guest's phone says so.

const VIOLET = { bg: "#F1ECFB", border: "#6B3FA0", ink: "#4B2A78" };

export default function GuestLinesPanel({
  lines,
  busy,
  touch = false,
  onConfirm,
  onReject,
}: {
  lines: PendingGuestLine[];
  busy: boolean;
  touch?: boolean;
  onConfirm: (lineIds: string[]) => void;
  onReject: (lineIds: string[]) => void;
}) {
  if (lines.length === 0) return null;
  const all = lines.map((l) => l.id);
  const button = (primary: boolean) =>
    ({
      height: touch ? 44 : 32,
      padding: touch ? "0 14px" : "0 10px",
      border: primary ? "none" : `1px solid ${VIOLET.border}`,
      borderRadius: touch ? TOUCH.radius : 7,
      background: primary ? VIOLET.border : "#fff",
      color: primary ? "#fff" : VIOLET.ink,
      fontSize: touch ? 14 : 12.5,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 5,
      cursor: busy ? "progress" : "pointer",
      opacity: busy ? 0.6 : 1,
      flexShrink: 0,
      touchAction: "manipulation",
    }) as const;
  return (
    <section
      aria-label="Guest order waiting"
      data-guest-pending={lines.length}
      style={{ margin: touch ? "6px 6px 0" : 0, border: `2px solid ${VIOLET.border}`, borderRadius: touch ? TOUCH.radius : 10, background: VIOLET.bg, color: VIOLET.ink, display: "flex", flexDirection: "column", maxHeight: touch ? 260 : undefined, overflow: "hidden" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: touch ? "8px 8px 8px 12px" : "8px 10px", borderBottom: `1px solid ${VIOLET.border}33` }}>
        <ShoppingBag size={touch ? 18 : 16} aria-hidden />
        <span style={{ flex: 1, fontSize: touch ? 15 : 13.5, fontWeight: 700 }}>
          Guest order · {lines.length} {lines.length === 1 ? "line" : "lines"} to confirm
        </span>
        <button type="button" data-guest-confirm-all disabled={busy} onClick={() => onConfirm(all)} style={button(true)}>
          <Check size={touch ? 17 : 14} aria-hidden /> Confirm all
        </button>
      </div>
      <div style={{ overflowY: "auto", minHeight: 0 }}>
        {lines.map((line) => (
          <div key={line.id} data-guest-pending-line={line.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: touch ? "8px 8px 8px 12px" : "7px 10px", borderBottom: `1px solid ${VIOLET.border}22`, fontSize: touch ? 14.5 : 13 }}>
            <span style={{ fontWeight: 700, minWidth: 24 }}>{line.quantity}×</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", color: touch ? TOUCH.ink : COLORS.ink }}>
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{line.name}</span>
              {line.detail && <span style={{ fontSize: touch ? 12.5 : 11.5, color: VIOLET.ink }}>{line.detail}</span>}
              <span style={{ fontSize: touch ? 12 : 11, color: VIOLET.ink, opacity: 0.8 }}>
                {line.amount} · sent {line.time}
              </span>
            </span>
            <button type="button" aria-label={`Reject ${line.name}`} title="Reject" data-guest-reject={line.name} disabled={busy} onClick={() => onReject([line.id])} style={button(false)}>
              <X size={touch ? 17 : 14} aria-hidden />
              {touch ? "" : "Reject"}
            </button>
            <button type="button" aria-label={`Confirm ${line.name}`} title="Confirm" data-guest-confirm={line.name} disabled={busy} onClick={() => onConfirm([line.id])} style={button(true)}>
              <Check size={touch ? 17 : 14} aria-hidden />
              {touch ? "" : "Confirm"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
