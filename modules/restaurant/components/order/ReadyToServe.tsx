"use client";

import { BellRing } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import type { TicketLine } from "../../server/queries/orderScreen";

// "Ready: 2× Jollof, 1× Tilapia" — what the kitchen has finished, above the
// ticket's lines, with Mark served for all of it. Hidden when nothing's ready.
export default function ReadyToServe({ lines, busy, onServe }: { lines: TicketLine[]; busy: boolean; onServe: (lines: TicketLine[]) => void }) {
  const ready = lines.filter((line) => line.canServe);
  if (ready.length === 0) return null;

  const byName = new Map<string, number>();
  for (const line of ready) byName.set(line.name, (byName.get(line.name) ?? 0) + line.quantity);
  const summary = [...byName].map(([name, quantity]) => `${quantity}× ${name}`).join(", ");

  return (
    <div
      role="status"
      aria-label="Ready to serve"
      style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 10, background: COLORS.tealTint, border: `1px solid ${COLORS.tealBorder}`, display: "flex", alignItems: "center", gap: 10 }}
    >
      <BellRing size={16} strokeWidth={1.8} color={COLORS.tealDark} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: COLORS.tealDark }}>
        <strong>Ready:</strong> {summary}
      </span>
      <button
        type="button"
        onClick={() => onServe(ready)}
        disabled={busy}
        style={{ height: 32, padding: "0 12px", border: "none", borderRadius: 7, background: COLORS.teal, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0, opacity: busy ? 0.7 : 1 }}
      >
        Mark served
      </button>
    </div>
  );
}
