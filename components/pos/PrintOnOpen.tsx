"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import PosButton from "./PosButton";
import { POS } from "./theme";

// The receipt's Print button. Opens the print dialog once on load (the
// cashier asked for it from the "Sale complete" dialog).
export default function PrintOnOpen() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <PosButton
      className="no-print"
      onClick={() => window.print()}
      style={{
        height: 44,
        padding: "0 20px",
        borderRadius: 10,
        background: POS.indigo,
        color: "#fff",
        fontSize: 14.5,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
      hoverStyle={{ background: POS.indigoHover }}
    >
      <Printer size={17} strokeWidth={1.6} />
      Print
    </PosButton>
  );
}
