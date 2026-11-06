"use client";

import { useEffect, useState } from "react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { CUSTOMER_DISPLAY_CHANNEL, type DisplayMessage } from "@/lib/hardware/customerDisplay";

// The customer-facing screen (a stub): what the POS in this browser posts —
// welcome, the cart and its total, then the change and a thank-you.
export default function CustomerDisplay({ business }: { business: string }) {
  const [message, setMessage] = useState<DisplayMessage>({ kind: "idle" });
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    channel.onmessage = (event: MessageEvent<DisplayMessage>) => setMessage(event.data);
    return () => channel.close();
  }, []);

  return (
    <div data-display={message.kind} style={{ minHeight: "100vh", background: COLORS.ink, color: "#fff", fontFamily: FONTS.body, display: "flex", flexDirection: "column", padding: "40px 56px" }}>
      <div style={{ fontFamily: FONTS.display, fontSize: 28, fontWeight: 700, opacity: 0.9 }}>{business}</div>
      {message.kind === "idle" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontSize: 64, fontWeight: 700 }}>Welcome!</div>
      )}
      {message.kind === "cart" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", marginTop: 32 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, fontSize: 26 }}>
            {message.lines.slice(-8).map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 16 }}>
                <span style={{ width: 70, opacity: 0.7 }}>{line.quantity}×</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.name}</span>
                <span style={{ fontFamily: FONTS.mono }}>{line.total}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,.25)", paddingTop: 20, fontFamily: FONTS.display, fontSize: 48, fontWeight: 700 }}>
            <span>Total</span>
            <span data-display-total>{message.total}</span>
          </div>
        </div>
      )}
      {message.kind === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={{ fontSize: 30, opacity: 0.8 }}>Paid {message.paid}</div>
          <div style={{ fontFamily: FONTS.display, fontSize: 56, fontWeight: 700 }}>Change {message.change}</div>
          <div style={{ fontSize: 30 }}>Thank you!</div>
        </div>
      )}
    </div>
  );
}
