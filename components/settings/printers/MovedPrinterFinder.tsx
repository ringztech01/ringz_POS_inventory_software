"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { COLORS } from "@/components/layout/theme";
import { findMovedPrinter, movePrinter } from "@/app/(dashboard)/settings/printers/actions";
import type { MoveSuggestion } from "@/lib/hardware/redetect";

// A network printer that doesn't answer (Step 7): perhaps it got a new IP.
// "Find new IP" scans the network for the same MAC address (else the one
// printer of its model) and suggests the address; the admin says yes.
export default function MovedPrinterFinder({ printerId, name }: { printerId: string; name: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "scanning" | "moving">("idle");
  const [suggestion, setSuggestion] = useState<MoveSuggestion | null>(null);
  const [none, setNone] = useState(false);

  async function scan() {
    setState("scanning");
    setNone(false);
    const result = await findMovedPrinter(printerId);
    setState("idle");
    if (!result.ok) return toast.error(result.error);
    setSuggestion(result.suggestion);
    setNone(!result.suggestion);
  }

  async function use(address: string) {
    setState("moving");
    const result = await movePrinter(printerId, address);
    setState("idle");
    if (!result.ok) return toast.error(result.error);
    toast.success(`${name} now prints to ${address} — same assignments.`);
    setSuggestion(null);
    router.refresh();
  }

  const link = { border: "none", background: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: COLORS.tealDark, textDecoration: "underline", cursor: "pointer" } as const;
  return (
    <div data-moved-finder style={{ marginTop: 6, fontSize: 12.5, color: COLORS.slate, maxWidth: 260, whiteSpace: "normal" }}>
      {suggestion ? (
        <span data-suggested={suggestion.address}>
          Found at <b>{suggestion.address}</b> ({suggestion.by === "mac" ? "same MAC address" : `same model${suggestion.model ? `, ${suggestion.model}` : ""}`}).{" "}
          <button type="button" style={link} disabled={state !== "idle"} onClick={() => void use(suggestion.address)}>
            {state === "moving" ? "Saving…" : "Use this address"}
          </button>
        </span>
      ) : (
        <>
          {none && <span style={{ display: "block", marginBottom: 2 }}>Not found on the network — is it switched on?</span>}
          <button type="button" style={link} disabled={state !== "idle"} onClick={() => void scan()}>
            {state === "scanning" ? "Scanning the network…" : none ? "Scan again" : "Find new IP"}
          </button>
        </>
      )}
    </div>
  );
}
