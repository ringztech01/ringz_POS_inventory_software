"use client";

import type { CounterOrder } from "../../server/queries/posScreen";
import { TakeawayBag } from "../floor/RequestBell";
import { T } from "./tabletTheme";

// The open takeaways and bar tabs on the tablet's Tables (6g follow-up 2):
// the desktop Tables screen's strip, touch-sized — a takeaway with a bag, a
// tab without. Upright: a row across, scrolling sideways; on the floor's
// side panel (landscape): a list. A tap opens the order.
export default function TabletCounter({ counter, onOpen, layout }: { counter: readonly CounterOrder[]; onOpen: (orderId: string) => void; layout: "row" | "list" }) {
  if (counter.length === 0) return null;
  const row = layout === "row";
  return (
    <div data-tablet-counter={layout} aria-label="Takeaways and tabs" style={row ? { display: "flex", gap: 8, padding: "0 16px 12px", overflowX: "auto", flex: "none", scrollbarWidth: "none" } : { display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
      {!row && <span style={{ fontSize: 15, fontWeight: 800, color: T.quiet, letterSpacing: ".04em" }}>TAKEAWAYS & TABS</span>}
      {counter.map((o) => (
        <button
          key={o.id}
          type="button"
          className="tb-press"
          data-counter-order={o.label}
          data-counter-type={o.type}
          data-counter-id={o.id}
          onClick={() => onOpen(o.id)}
          style={{ height: 64, flex: "none", minWidth: row ? 180 : undefined, padding: "0 16px", border: "none", borderRadius: 8, background: o.type === "BAR_TAB" ? T.bar2 : T.teal, color: T.text, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 2, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 19, fontWeight: 900, maxWidth: row ? 260 : "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {o.type === "TAKEAWAY" && <TakeawayBag size={19} />}
            {o.label}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, opacity: 0.9, whiteSpace: "nowrap" }}>
            {o.lines} {o.lines === 1 ? "item" : "items"} · {o.open}
          </span>
        </button>
      ))}
    </div>
  );
}
