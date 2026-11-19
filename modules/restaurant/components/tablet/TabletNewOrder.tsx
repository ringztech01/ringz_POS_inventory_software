"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { newPosOrder } from "../../server/actions/pos";
import { tabletOrder, TABLET_TABLES } from "../../lib/tabletDevice";
import { T } from "./tabletTheme";

// /t/order/new?type=TAKEAWAY|BAR_TAB[&name=…] (Part 6g Step 5): opens the
// takeaway or the named bar tab with the desktop POS's own action, once,
// and moves to its Order screen (replacing this page, so a reload or Back
// can't open a second one). An order left with nothing on it is let go
// when the waiter goes back to Tables.
export default function TabletNewOrder({ type, name }: { type: "TAKEAWAY" | "BAR_TAB"; name: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const result = await newPosOrder(type === "BAR_TAB" ? { type, tabName: name } : { type }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Check the connection and try again." }));
      if (result.ok) router.replace(tabletOrder(result.orderId));
      else setError(result.error);
    })();
  }, [router, type, name]);
  return (
    <div data-tablet-new-order={type} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, padding: 40, textAlign: "center" }}>
      <span style={{ fontSize: 34, fontWeight: 900 }}>{error ? "Couldn't open it" : type === "BAR_TAB" ? `Opening ${name}'s tab…` : "Opening a takeaway…"}</span>
      {error && (
        <>
          <span role="alert" style={{ fontSize: 20, fontWeight: 700, color: T.danger }}>
            {error}
          </span>
          <button type="button" className="tb-press" onClick={() => router.push(TABLET_TABLES)} style={{ height: 84, padding: "0 32px", border: "none", borderRadius: 8, background: T.buttonAlt, color: T.text, fontSize: 22, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }}>
            ‹ TABLES
          </button>
        </>
      )}
    </div>
  );
}
