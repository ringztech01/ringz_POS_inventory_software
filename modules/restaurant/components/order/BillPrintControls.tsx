"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { printOrderBill } from "../../server/actions/bill";

// The pre-bill's on-screen controls (never printed). Printing records the
// print first (printOrderBill → Order.billPrintedAt), then opens the print
// dialog; with ?autoprint=1 that happens on load and the tab closes after.
export default function BillPrintControls({ orderId, autoprint }: { orderId: string; autoprint: boolean }) {
  const [warning, setWarning] = useState<string | null>(null);
  const started = useRef(false);

  async function print(closeAfter: boolean) {
    try {
      const result = await printOrderBill(orderId);
      if (!result.ok) setWarning(`${result.error} It will print, but the print wasn't recorded.`);
    } catch {
      setWarning("Couldn't reach the server — it will print, but the print wasn't recorded.");
    }
    if (closeAfter) window.addEventListener("afterprint", () => window.close(), { once: true });
    window.print();
  }

  // ?autoprint=1: once, on load.
  const printOnLoad = useEffectEvent(() => void print(true));
  useEffect(() => {
    if (!autoprint || started.current) return;
    const timer = setTimeout(() => {
      started.current = true;
      printOnLoad();
    }, 300);
    return () => clearTimeout(timer);
  }, [autoprint]);

  return (
    <div className="no-print" style={{ position: "fixed", top: 16, right: 16, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, maxWidth: 260 }}>
      <button
        type="button"
        onClick={() => void print(false)}
        style={{ height: 38, padding: "0 16px", display: "flex", alignItems: "center", gap: 8, background: COLORS.teal, border: "none", borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
      >
        <Printer size={15} strokeWidth={1.7} />
        Print
      </button>
      {warning && (
        <p role="alert" style={{ margin: 0, padding: "8px 10px", borderRadius: 8, background: COLORS.dangerBg, color: COLORS.danger, fontSize: 12.5, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
          {warning}
        </p>
      )}
    </div>
  );
}
