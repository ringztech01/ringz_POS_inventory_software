"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

// The QR sheet's Print button. Opens the print dialog once on load — the
// sheet is opened from "Print all QR codes".
export default function PrintSheetButton() {
  const hover = useToggleState();

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 38,
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: hover.value ? COLORS.tealDark : COLORS.teal,
        border: "none",
        borderRadius: 8,
        color: "#fff",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <Printer size={15} strokeWidth={1.7} />
      Print
    </button>
  );
}
