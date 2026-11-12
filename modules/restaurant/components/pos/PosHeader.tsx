"use client";

import { useSyncExternalStore } from "react";
import { LayoutGrid, Lock, Maximize, Minimize } from "lucide-react";
import { useFullscreen } from "@/components/pos/use-fullscreen";
import type { OrderType } from "@prisma/client";
import { staffBadge } from "../../lib/posSpeed";
import { formatAppTime } from "../../lib/time";
import { TOUCH } from "../../lib/theme";
import { usePosSession } from "./PosSession";
import PrinterLights from "./PrinterLights";
import TouchButton from "./TouchButton";

// Quick order types: Dine-in picks a table on the floor plan; Takeaway opens
// one at once; Bar tab asks for a name first.
const TYPES = [
  { type: "DINE_IN", label: "Dine-in" },
  { type: "TAKEAWAY", label: "Takeaway" },
  { type: "BAR_TAB", label: "Bar tab" },
] as const satisfies readonly { type: OrderType; label: string }[];

// The clock: re-read every few seconds; nothing on the server render (no
// mismatch when the page hydrates).
function subscribeClock(onChange: () => void) {
  const timer = setInterval(onChange, 5_000);
  return () => clearInterval(timer);
}
const readClock = () => formatAppTime(new Date());
const noClock = () => "";

export type HeaderFacts = {
  // "Table 12", "Takeaway", "Tab · Ada", "No table open".
  title: string;
  // Under it, quieter: "Main hall · 4 covers".
  detail: string | null;
  // "ORD-0208".
  orderRef: string | null;
  // "Billed" / "Cancelled" on a closed order.
  closed: string | null;
  // A training order (Part 6f Step 7f): tagged TRAINING.
  training?: boolean;
};

// The touch POS's top strip (the Restaurant POS design): RingzPOS ·
// RESTAURANT, the table (tap: the floor plan), the quick order types (the
// current one lit), the order number, the printers' lights, who's on the
// till (tap: switch by PIN), the time, full screen and — for a back-office
// role — Back office (Part 6f Step 5).
export default function PosHeader({ facts, saving, orderType = null, orderId }: { facts: HeaderFacts; saving: boolean; orderType?: OrderType | null; orderId?: string }) {
  const session = usePosSession();
  const fullscreen = useFullscreen();
  const clock = useSyncExternalStore(subscribeClock, readClock, noClock);
  const badge = staffBadge(session.userName);

  return (
    <header
      data-pos-header
      style={{ background: TOUCH.header, color: TOUCH.text, borderBottom: `1px solid ${TOUCH.line}`, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", minWidth: 0, whiteSpace: "nowrap" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: TOUCH.display, fontWeight: 700, fontSize: 18, color: TOUCH.text }}>RingzPOS</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.doneInk, background: TOUCH.doneBg, padding: "3px 7px", borderRadius: 3 }}>RESTAURANT</span>
      </div>

      <TouchButton
        data-pos-table
        aria-label={`${facts.title} — the floor plan`}
        background={TOUCH.key}
        onClick={() => session.goTables(orderId)}
        style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0, flexShrink: 1, overflow: "hidden" }}
      >
        <span data-pos-title style={{ fontFamily: TOUCH.display, fontSize: 17, fontWeight: 700 }}>
          {facts.title}
        </span>
        {facts.detail && <span style={{ fontSize: 13, fontWeight: 500, color: TOUCH.textDim, overflow: "hidden", textOverflow: "ellipsis" }}>{facts.detail}</span>}
      </TouchButton>

      <div role="group" aria-label="New order" data-order-types style={{ display: "flex", gap: 4, background: TOUCH.key, padding: 3, borderRadius: TOUCH.radius, flexShrink: 0 }}>
        {TYPES.map(({ type, label }) => {
          const on = orderType === type;
          return (
            <TouchButton
              key={type}
              data-order-type={type}
              aria-pressed={on}
              disabled={session.busy}
              background={on ? TOUCH.teal : "transparent"}
              color={on ? "#fff" : TOUCH.textDim}
              pressedBackground={on ? undefined : TOUCH.keyDown}
              onClick={() => (type === "DINE_IN" ? session.goTables(orderId) : type === "TAKEAWAY" ? session.newTakeaway() : session.openBarTab())}
              style={{ height: 32, padding: "0 14px", borderRadius: 3, fontSize: 14, fontWeight: 600 }}
            >
              {label}
            </TouchButton>
          );
        })}
      </div>

      {facts.orderRef && <span style={{ fontFamily: TOUCH.mono, fontSize: 14, fontWeight: 600, color: TOUCH.textDim, flexShrink: 0 }}>{facts.orderRef}</span>}
      {facts.training && (
        <span data-training-tag style={{ padding: "3px 8px", borderRadius: 3, background: "#F2B233", color: "#3B2A00", fontSize: 12, fontWeight: 800, letterSpacing: ".06em", flexShrink: 0 }}>TRAINING</span>
      )}
      {facts.closed && (
        <span style={{ padding: "3px 8px", borderRadius: 3, background: TOUCH.key, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{facts.closed}</span>
      )}

      <div style={{ flex: 1 }} />
      {saving && <span style={{ fontSize: 13, color: TOUCH.textDim }}>Saving…</span>}
      <PrinterLights />

      <TouchButton
        data-pos-user
        aria-label={`${session.userName} — switch user`}
        title="Switch user (PIN)"
        background={TOUCH.key}
        onClick={session.openSwitch}
        style={{ height: 38, padding: "0 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, maxWidth: 190, flexShrink: 0 }}
      >
        <span aria-hidden style={{ width: 26, height: 26, borderRadius: "50%", background: TOUCH.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {badge.initials}
        </span>
        <span data-pos-user-name style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{badge.short}</span>
        <Lock size={15} strokeWidth={1.8} color={TOUCH.textDim} style={{ flexShrink: 0 }} />
      </TouchButton>
      <span data-pos-clock style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 600, color: TOUCH.text, paddingLeft: 4, fontVariantNumeric: "tabular-nums", minWidth: 50, textAlign: "right", flexShrink: 0 }}>
        {clock}
      </span>
      <TouchButton
        data-pos-fullscreen
        aria-label={fullscreen.active ? "Leave full screen" : "Full screen"}
        title={fullscreen.active ? "Leave full screen" : "Full screen"}
        background={TOUCH.key}
        onClick={() => void fullscreen.toggle()}
        style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        {fullscreen.active ? <Minimize size={17} strokeWidth={2} /> : <Maximize size={17} strokeWidth={2} />}
      </TouchButton>
      <BackOfficeKey />
    </header>
  );
}

// The service header's Back office key (Part 6f Step 5): a Manager or the
// Administrator opens the back office (the dashboard); the back office's
// Service button brings them back. A Service-level role has no back office:
// the key isn't rendered at all.
export function BackOfficeKey() {
  const session = usePosSession();
  if (!session.leaveHref) return null;
  return (
    <TouchButton data-back-office aria-label="Back office" title="Back office" background={TOUCH.key} onClick={session.exit} style={{ height: 38, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
      <LayoutGrid size={15} strokeWidth={2} /> Back office
    </TouchButton>
  );
}
