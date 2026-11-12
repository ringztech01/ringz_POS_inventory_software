"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { typeKey } from "../../lib/optionFlow";
import { TOUCH } from "../../lib/theme";
import { TAB_NAME_MAX } from "../../schemas/pos";
import OnScreenKeyboard from "./OnScreenKeyboard";
import TouchButton from "./TouchButton";

// A new bar tab: its name ("Ada — blue shirt") on the on-screen keyboard
// (or a desk keyboard), then Open tab. Also a new check at a shared table
// (`check`: its table), where the name is optional.
export default function BarTabDialog({
  busy,
  onOpen,
  onClose,
  check,
}: {
  busy: boolean;
  onOpen: (name: string) => void;
  onClose: () => void;
  check?: string;
}) {
  const [name, setName] = useState("");
  const latest = useRef(name);
  const update = (next: string) => {
    latest.current = next.slice(0, TAB_NAME_MAX);
    setName(latest.current);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") return onClose();
      if (event.key === "Enter") return (check || latest.current.trim()) && onOpen(latest.current.trim());
      if (event.key === "Backspace") update(latest.current.slice(0, -1));
      else if (event.key.length === 1) update(typeKey(latest.current, event.key, { words: true }));
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onOpen, check]);

  const ready = (!!check || name.trim().length > 0) && !busy;
  return (
    <div role="dialog" aria-label={check ? `New check at ${check}` : "New bar tab"} data-bar-tab-dialog={check ? undefined : ""} data-check-dialog={check ? "" : undefined} style={{ position: "fixed", inset: 0, zIndex: 150, background: TOUCH.scrim, color: TOUCH.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "min(920px, 100%)", height: "min(560px, 100%)", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) 64px", gap: TOUCH.gap }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>{check ? `New check · ${check}` : "New bar tab"}</h2>
          <TouchButton aria-label="Close" background={TOUCH.raised} onClick={onClose} style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={24} strokeWidth={2.4} />
          </TouchButton>
        </div>
        <div data-tab-name style={{ minHeight: 52, padding: "8px 14px", borderRadius: TOUCH.radius, background: TOUCH.check, color: TOUCH.ink, fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center" }}>
          {name || <span style={{ color: TOUCH.inkDim, fontSize: 16, fontWeight: 600 }}>{check ? "The guest's name (optional) — or just Open check" : "The guest's name, or what they look like"}</span>}
        </div>
        <OnScreenKeyboard onKey={(key) => update(typeKey(latest.current, key, { words: true }))} onDelete={() => update(latest.current.slice(0, -1))} onClear={() => update("")} />
        <TouchButton data-open-tab background={TOUCH.pay} disabled={!ready} onClick={() => ready && onOpen(name.trim())} style={{ fontSize: 20, fontWeight: 800, opacity: ready ? 1 : 0.4 }}>
          {busy ? "Opening…" : `${check ? "Open check" : "Open tab"}${name.trim() ? ` · ${name.trim()}` : ""}`}
        </TouchButton>
      </div>
    </div>
  );
}
