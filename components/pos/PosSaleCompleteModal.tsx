"use client";

import { useEffect } from "react";
import { CircleCheck, ExternalLink, Printer } from "lucide-react";
import type { PaymentStatus } from "@prisma/client";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { PaymentStatusPill } from "@/components/purchases/purchase-display";
import PosButton from "./PosButton";
import { POS } from "./theme";

export type CompletedSale = {
  id: string;
  reference: string;
  // 2dp strings.
  total: string;
  paid: string;
  change: string;
  paymentStatus: PaymentStatus;
};

const linkStyle = {
  height: 48,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontSize: 15,
  fontWeight: 600,
  textDecoration: "none",
} as const;

// After a successful payment: the SA_ reference, the change to hand back,
// and the receipt. The cart is already cleared behind it.
export default function PosSaleCompleteModal({
  sale,
  canViewSales,
  onClose,
}: {
  sale: CompletedSale;
  // Manage Sale: also offer the sale's details page.
  canViewSales: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(23,27,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "80px 16px",
      }}
    >
      <div
        role="dialog"
        aria-label="Sale complete"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 460,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)",
          padding: "28px 24px 22px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          animation: "elv-pop .12s ease-out",
        }}
      >
        <span style={{ color: POS.green, display: "flex" }}>
          <CircleCheck size={44} strokeWidth={1.6} />
        </span>
        <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 21, fontWeight: 700 }}>Sale complete</h3>
        <span
          aria-label="Reference"
          style={{
            fontFamily: FONTS.mono,
            fontSize: 14,
            fontWeight: 600,
            background: POS.indigoTint,
            color: POS.indigo,
            padding: "5px 12px",
            borderRadius: 8,
          }}
        >
          {sale.reference}
        </span>

        <div style={{ width: "100%", borderTop: `1px solid ${COLORS.border}`, marginTop: 4, paddingTop: 10 }}>
          {[
            ["Total", sale.total],
            ["Paid", sale.paid],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
              <span style={{ color: COLORS.slate }}>{label}</span>
              <span style={{ fontFamily: FONTS.mono, fontWeight: 600 }}>{formatNaira(value)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 14 }}>
            <span style={{ color: COLORS.slate }}>Payment status</span>
            <PaymentStatusPill paymentStatus={sale.paymentStatus} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 2px", fontSize: 17 }}>
            <span style={{ fontWeight: 600 }}>Change</span>
            <span aria-label="Change due" style={{ fontFamily: FONTS.display, fontWeight: 700 }}>
              {formatNaira(sale.change)}
            </span>
          </div>
        </div>

        <div style={{ width: "100%", display: "grid", gridTemplateColumns: canViewSales ? "1fr 1fr" : "1fr", gap: 10, marginTop: 6 }}>
          <a href={`/pos/receipt/${sale.id}`} target="_blank" rel="noopener" style={{ ...linkStyle, background: POS.indigo, color: "#fff" }}>
            <Printer size={18} strokeWidth={1.6} />
            Print receipt
          </a>
          {canViewSales && (
            <a href={`/sales/${sale.id}`} target="_blank" rel="noopener" style={{ ...linkStyle, background: POS.chip, color: COLORS.slate }}>
              <ExternalLink size={17} strokeWidth={1.6} />
              View sale
            </a>
          )}
        </div>
        <PosButton
          onClick={onClose}
          autoFocus
          style={{ width: "100%", height: 52, borderRadius: 12, background: POS.green, color: "#fff", fontSize: 16, fontWeight: 600 }}
          hoverStyle={{ background: POS.greenHover }}
        >
          New sale
        </PosButton>
      </div>
    </div>
  );
}
