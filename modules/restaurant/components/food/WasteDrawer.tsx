"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { R } from "../../lib/theme";
import { formatAppDateTime } from "../../lib/time";
import type { WasteRow } from "../../server/queries/waste";
import { WasteReasonPill, WasteStatusPill } from "./WastePills";

const label = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid } as const;

function Detail({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-detail={name} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={label}>{name}</span>
      <span style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

// A waste entry, read-only (Food › Waste › View): what was logged, by whom
// and why, its cost as logged, the stock lines that came out (exactly what a
// void puts back) and, voided, who voided it and why.
export default function WasteDrawer({ entry, canVoid, onVoid, onClose }: { entry: WasteRow; canVoid: boolean; onVoid: () => void; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(7,27,24,.32)", zIndex: 70, display: "flex", justifyContent: "flex-end", animation: "elv-fade .12s ease-out" }}>
      <aside
        role="dialog"
        aria-label="Waste entry"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 460, maxWidth: "100%", height: "100%", background: "#fff", boxShadow: "-12px 0 32px -12px rgba(23,27,28,.3)", display: "flex", flexDirection: "column" }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 22px", borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>{entry.item.name}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.slateMid }}>
              <span style={{ fontFamily: FONTS.mono }}>{entry.item.code}</span>· {formatAppDateTime(new Date(entry.createdAt))} <WasteStatusPill status={entry.status} />
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.slateMid, display: "flex", padding: 4 }}>
            <X size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Detail name="Quantity">
              <span style={{ fontFamily: FONTS.mono }}>
                {entry.qty} {entry.unit}
              </span>
            </Detail>
            <Detail name="Reason">
              <WasteReasonPill reason={entry.reason} />
            </Detail>
            <Detail name="Cost">
              <span style={{ fontWeight: 600 }}>{formatNaira(entry.cost)}</span>
            </Detail>
            <Detail name="Warehouse">{entry.warehouse}</Detail>
            <Detail name="Logged by">{entry.loggedBy}</Detail>
            <Detail name="Approved by">{entry.approvedBy ?? "—"}</Detail>
            {entry.order && (
              <Detail name="Order">
                {entry.order.ref} · {entry.order.item}
              </Detail>
            )}
          </div>
          {entry.note && <Detail name="Note">{entry.note}</Detail>}

          {entry.voided && (
            <div data-voided style={{ padding: 12, borderRadius: 10, background: "#fcecef", color: R.danger, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>
                Voided by {entry.voided.by} · {formatAppDateTime(new Date(entry.voided.at))}
              </span>
              {entry.voided.reason && <span style={{ color: COLORS.slate }}>{entry.voided.reason}</span>}
              <span style={{ color: COLORS.slate, fontSize: 12.5 }}>The lines below went back into stock.</span>
            </div>
          )}

          <section aria-label="Deducted from stock" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Deducted from stock</span>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: COLORS.slateMid, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  <th style={{ textAlign: "left", fontWeight: 600, padding: "6px 0" }}>Item</th>
                  <th style={{ textAlign: "right", fontWeight: 600, padding: "6px 0" }}>Qty</th>
                  <th style={{ textAlign: "right", fontWeight: 600, padding: "6px 0" }}>Unit cost</th>
                  <th style={{ textAlign: "right", fontWeight: 600, padding: "6px 0" }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line) => (
                  <tr key={line.productId} data-line={line.name} style={{ borderTop: `1px solid ${R.rowBorder}` }}>
                    <td style={{ padding: "8px 0" }}>{line.name}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontFamily: FONTS.mono }}>
                      {line.qty} {line.unit}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right", color: COLORS.slateMid }}>{formatNaira(line.unitCost)}</td>
                    <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>{formatNaira(line.lineCost)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td colSpan={3} style={{ padding: "10px 0", fontWeight: 600 }}>
                    Total
                  </td>
                  <td data-total style={{ padding: "10px 0", textAlign: "right", fontWeight: 600 }}>
                    {formatNaira(entry.cost)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        {canVoid && entry.status === "ACTIVE" && (
          <footer style={{ padding: "16px 22px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.bgInput, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onVoid}
              style={{ height: 38, padding: "0 18px", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: "#fff", color: R.danger, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              Void entry
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
