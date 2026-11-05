"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Printer } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { registerKotPrint } from "../../server/actions/kitchen";

// The printed ticket's on-screen controls (never printed) and its REPRINT
// line. Printing counts the print first (registerKotPrint), then opens the
// print dialog; with ?autoprint=1 that happens on load and the tab closes
// after printing.
export default function KotPrintControls({ kotId, printCount, autoprint }: { kotId: string; printCount: number; autoprint: boolean }) {
  // Prints before this one: the ticket says REPRINT #n when n > 0.
  const [earlier, setEarlier] = useState(printCount);
  const [warning, setWarning] = useState<string | null>(null);
  const started = useRef(false);

  async function print(closeAfter: boolean) {
    try {
      const result = await registerKotPrint({ kotId });
      if (result.ok) flushSync(() => setEarlier(result.printCount - 1));
      else setWarning(`${result.error} It will print, but the print wasn't counted.`);
    } catch {
      setWarning("Couldn't reach the server — it will print, but the print wasn't counted.");
    }
    if (closeAfter) window.addEventListener("afterprint", () => window.close(), { once: true });
    window.print();
    setEarlier((n) => n + 1);
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
    <>
      {earlier > 0 && (
        <div data-reprint style={{ margin: "6px 0", padding: "2px 0", border: "2px solid #000", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
          REPRINT #{earlier}
        </div>
      )}
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
    </>
  );
}
