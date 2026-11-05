"use client";

import { useEffect } from "react";
import { CircleCheck, Printer } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import PosButton from "@/components/pos/PosButton";
import { POS } from "@/components/pos/theme";

export type Settled = { saleId: string; reference: string; closed: boolean; paid: string; change: string; title: string; partsLeft: number };

// After a settle — the retail till's "Sale complete" look (PosSaleCompleteModal):
// the sale's reference, what was paid, the change to hand back, and the
// receipt (the retail receipt with the table and waiter). A split bill with
// parts still open says how many are left.
export default function SettledModal({ settled, onClose }: { settled: Settled; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(23,27,28,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "80px 16px" }}>
      <div
        role="dialog"
        aria-label={settled.closed ? "Bill settled" : "Part paid"}
        onClick={(event) => event.stopPropagation()}
        style={{ width: 460, background: "#fff", borderRadius: 16, boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)", padding: "28px 24px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, animation: "elv-pop .12s ease-out" }}
      >
        <span style={{ color: POS.green, display: "flex" }}>
          <CircleCheck size={44} strokeWidth={1.6} />
        </span>
        <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 21, fontWeight: 700 }}>{settled.closed ? "Bill settled" : `${settled.title} paid`}</h3>
        <span aria-label="Reference" style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600, background: POS.indigoTint, color: POS.indigo, padding: "5px 12px", borderRadius: 8 }}>
          {settled.reference}
        </span>
        {!settled.closed && (
          <span data-parts-left style={{ fontSize: 13.5, color: COLORS.slate }}>
            {settled.partsLeft} {settled.partsLeft === 1 ? "part" : "parts"} still to pay.
          </span>
        )}

        <div style={{ width: "100%", borderTop: `1px solid ${COLORS.border}`, marginTop: 4, paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
            <span style={{ color: COLORS.slate }}>Paid</span>
            <span style={{ fontFamily: FONTS.mono, fontWeight: 600 }}>{formatNaira(settled.paid)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 2px", fontSize: 17 }}>
            <span style={{ fontWeight: 600 }}>Change</span>
            <span aria-label="Change due" style={{ fontFamily: FONTS.display, fontWeight: 700 }}>
              {formatNaira(settled.change)}
            </span>
          </div>
        </div>

        <a
          href={`/restaurant/receipt/${settled.saleId}`}
          target="_blank"
          rel="noopener"
          style={{ width: "100%", height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15, fontWeight: 600, textDecoration: "none", background: POS.indigo, color: "#fff", marginTop: 6 }}
        >
          <Printer size={18} strokeWidth={1.6} />
          Print receipt
        </a>
        <PosButton onClick={onClose} autoFocus style={{ width: "100%", height: 52, borderRadius: 12, background: POS.green, color: "#fff", fontSize: 16, fontWeight: 600 }} hoverStyle={{ background: POS.greenHover }}>
          Done
        </PosButton>
      </div>
    </div>
  );
}
