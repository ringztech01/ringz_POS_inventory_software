"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Pause, Play, ShoppingBag } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { pauseGuestOrderingAction } from "../../server/actions/guestOrders";

// The dashboard's guest ordering switch (Part 8 Step 7): pause it at once
// (a rush, a problem in the kitchen) — guests still see the menu, Add to
// order is off — and resume it. For whoever looks after the menu.
export default function GuestOrderingSwitch({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    try {
      const result = await pauseGuestOrderingAction(!paused);
      if (result.ok) toast.success(paused ? "Guest ordering resumed." : "Guest ordering paused. Guests can still see the menu.");
      else toast.error(result.error);
    } catch {
      toast.error("Couldn't reach the server. Check the connection and try again.");
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <div data-guest-ordering={paused ? "paused" : "on"} style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 4px 0 12px", border: `1px solid ${paused ? "#fcd34d" : COLORS.borderStrong}`, borderRadius: 8, background: paused ? "#fffbeb" : "#fff", fontSize: 13, fontWeight: 600, color: paused ? "#92400e" : COLORS.slate }}>
      <ShoppingBag size={15} strokeWidth={1.9} aria-hidden />
      <span>Guest ordering: {paused ? "paused" : "on"}</span>
      <button
        type="button"
        data-guest-ordering-toggle
        disabled={busy}
        onClick={() => void flip()}
        style={{ height: 28, padding: "0 10px", border: "none", borderRadius: 6, background: paused ? COLORS.teal : "#92400e", color: "#fff", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.7 : 1 }}
      >
        {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
        {paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
