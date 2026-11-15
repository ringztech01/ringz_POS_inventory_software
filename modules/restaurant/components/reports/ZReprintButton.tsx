"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Printer } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { reprintZReport } from "../../server/actions/reports";

// A closed cash-up's Z-report, again, on its till's receipt printer.
export default function ZReprintButton({ sessionId, device }: { sessionId: string; device: string }) {
  const [busy, setBusy] = useState(false);
  async function reprint() {
    setBusy(true);
    try {
      const result = await reprintZReport(sessionId);
      if (result.ok) toast.success(`Z-report sent to ${result.printer}.`);
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setBusy(false);
  }
  return (
    <button
      type="button"
      data-z-reprint={sessionId}
      disabled={busy}
      onClick={reprint}
      title={`Print this Z-report again on ${device}'s receipt printer`}
      style={{ height: 30, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 7, background: "#fff", color: COLORS.text, fontSize: 12.5, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}
    >
      <Printer size={13} strokeWidth={1.8} />
      {busy ? "Sending…" : "Reprint Z"}
    </button>
  );
}
