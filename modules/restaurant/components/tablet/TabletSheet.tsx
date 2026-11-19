"use client";

import { useEffect, useState, type ReactNode } from "react";
import { T } from "./tabletTheme";

// The tablet's bottom sheet (design: the "How many guests?" sheet): dark,
// flat, over a dimmed screen; a tap outside closes it. And its one-line
// toast near the top ("+1 Star Lager", "Sent to Kitchen + Bar").

export default function TabletSheet({ title, aside, onClose, children, data }: { title: ReactNode; aside?: ReactNode; onClose: () => void; children: ReactNode; data?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" data-tablet-sheet={data} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "92%", overflowY: "auto", background: T.raised, borderRadius: "18px 18px 0 0", padding: "28px 24px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
          <span style={{ fontSize: 34, fontWeight: 900, minWidth: 0 }}>{title}</span>
          {aside && <span style={{ fontSize: 20, fontWeight: 700, color: T.quiet, textAlign: "right" }}>{aside}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SheetButton({ children, onClick, background = T.edge, color = T.text, height = 112, disabled = false, data, fontSize = 24 }: { children: ReactNode; onClick: () => void; background?: string; color?: string; height?: number; disabled?: boolean; data?: Record<string, string>; fontSize?: number }) {
  return (
    <button
      type="button"
      className="tb-press"
      disabled={disabled}
      onClick={onClick}
      {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
      style={{ height, border: "none", borderRadius: 8, background, color, fontSize, fontWeight: 900, fontFamily: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, padding: "0 16px" }}
    >
      {children}
    </button>
  );
}

// One line, white on the dark screen, for 1.8 s.
export function useTabletToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return [toast?.text ?? null, (text: string) => setToast({ text, at: Date.now() })];
}

export function TabletToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" data-tablet-toast style={{ position: "absolute", left: 24, right: 24, top: 110, zIndex: 40, background: T.text, color: "#000", padding: "20px 24px", borderRadius: 10, fontSize: 21, fontWeight: 800, textAlign: "center", pointerEvents: "none" }}>
      {text}
    </div>
  );
}

// A large on-screen keyboard (no system keyboard over the screen): letters,
// digits, Space, ⌫ and Clear. For a bar tab's name.
const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM-'"];
export function TabletKeyboard({ onKey, onDelete, onClear }: { onKey: (key: string) => void; onDelete: () => void; onClear: () => void }) {
  const key = (label: string, onClick: () => void, span = 1, data?: string, background: string = T.buttonAlt) => (
    <button
      key={`${label}-${data ?? ""}`}
      type="button"
      className="tb-press"
      data-tablet-key={data ?? label}
      onClick={onClick}
      style={{ gridColumn: `span ${span}`, height: 76, border: "none", borderRadius: 8, background, color: T.text, fontSize: label.length > 1 ? 20 : 28, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Keyboard" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ROWS.map((row) => (
        <div key={row} style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 8 }}>
          {[...row].map((c) => key(c, () => onKey(/[A-Z]/.test(c) ? c.toLowerCase() : c)))}
        </div>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: 8 }}>
        {key("CLEAR", onClear, 2, "clear", T.edge)}
        {key("SPACE", () => onKey(" "), 6, "space")}
        {key("⌫", onDelete, 2, "delete", T.edge)}
      </div>
    </div>
  );
}
