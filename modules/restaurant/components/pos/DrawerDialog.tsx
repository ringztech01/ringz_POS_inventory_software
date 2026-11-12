"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { typeKey } from "../../lib/optionFlow";
import { TOUCH } from "../../lib/theme";
import OnScreenKeyboard from "./OnScreenKeyboard";
import TouchButton from "./TouchButton";

const REASONS = ["Change for a guest", "Cash count", "Wrong tender", "Float"];
const NOTE_MAX = 140;

// Open drawer from the touch POS: why (a tap on a usual reason, or typed),
// then Open. Who may — or a manager's PIN — is the caller's.
export default function DrawerDialog({ busy, onOpen, onClose }: { busy: boolean; onOpen: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const latest = useRef(reason);
  const update = (next: string) => {
    latest.current = next.slice(0, NOTE_MAX);
    setReason(latest.current);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (document.querySelector("[data-pin-switch]") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") return onClose();
      if (event.key === "Enter") return latest.current.trim() && onOpen(latest.current.trim());
      if (event.key === "Backspace") update(latest.current.slice(0, -1));
      else if (event.key.length === 1) update(typeKey(latest.current, event.key));
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onOpen]);

  const ready = reason.trim().length > 0 && !busy;
  return (
    <div role="dialog" aria-label="Open the drawer" data-drawer-dialog style={{ position: "fixed", inset: 0, zIndex: 150, background: TOUCH.scrim, color: TOUCH.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "min(920px, 100%)", height: "min(600px, 100%)", display: "grid", gridTemplateRows: "auto auto auto minmax(0,1fr) 64px", gap: TOUCH.gap }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>Open the drawer — why?</h2>
          <TouchButton aria-label="Close" background={TOUCH.raised} onClick={onClose} style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={24} strokeWidth={2.4} />
          </TouchButton>
        </div>
        <div role="group" aria-label="Usual reasons" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gridAutoRows: 52, gap: TOUCH.gap }}>
          {REASONS.map((r) => (
            <TouchButton key={r} data-drawer-reason={r} aria-pressed={reason === r} background={reason === r ? TOUCH.selected : TOUCH.raised} onClick={() => update(r)} style={{ fontSize: 16, fontWeight: 800 }}>
              {r}
            </TouchButton>
          ))}
        </div>
        <div data-drawer-note style={{ minHeight: 48, padding: "8px 14px", borderRadius: TOUCH.radius, background: TOUCH.check, color: TOUCH.ink, fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center" }}>
          {reason || <span style={{ color: TOUCH.inkDim, fontSize: 15, fontWeight: 600 }}>Tap a reason, or type one</span>}
        </div>
        <OnScreenKeyboard onKey={(key) => update(typeKey(latest.current, key))} onDelete={() => update(latest.current.slice(0, -1))} onClear={() => update("")} />
        <TouchButton data-open-drawer background={TOUCH.pay} disabled={!ready} onClick={() => ready && onOpen(reason.trim())} style={{ fontSize: 20, fontWeight: 800, opacity: ready ? 1 : 0.4 }}>
          {busy ? "Opening…" : "Open drawer"}
        </TouchButton>
      </div>
    </div>
  );
}
