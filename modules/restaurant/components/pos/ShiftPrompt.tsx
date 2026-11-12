"use client";

import { useEffect } from "react";
import { TOUCH } from "../../lib/theme";
import TouchButton from "./TouchButton";

// Clock in / out (Part 6f Step 6): "Start shift?" after a PIN sign-in, and
// "End shift?" at LOCK — big keys over the screen. `choices`: the keys, the
// first one the main (teal) one; Esc picks the last.
export default function ShiftPrompt({
  title,
  detail,
  choices,
  busy = false,
}: {
  title: string;
  detail: string;
  choices: { label: string; onPick: () => void; data: string; tone?: "main" | "plain" | "danger" }[];
  busy?: boolean;
}) {
  const last = choices[choices.length - 1];
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      last.onPick();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [last, busy]);

  return (
    <div role="dialog" aria-label={title} data-shift-prompt style={{ position: "fixed", inset: 0, zIndex: 220, background: TOUCH.scrim, color: TOUCH.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, lineHeight: "normal" }}>
      <div style={{ width: "min(560px, 100%)", background: TOUCH.header, borderRadius: TOUCH.radius, padding: 28, display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 20px 60px rgba(0,0,0,.45)" }}>
        <h2 style={{ margin: 0, fontFamily: TOUCH.display, fontSize: 28, fontWeight: 700 }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 16, color: TOUCH.textDim, lineHeight: 1.45 }}>{detail}</p>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`, gap: 10, marginTop: 6 }}>
          {choices.map((choice, i) => {
            const tone = choice.tone ?? (i === 0 ? "main" : "plain");
            return (
              <TouchButton
                key={choice.label}
                data-shift-choice={choice.data}
                disabled={busy}
                background={tone === "main" ? TOUCH.teal : tone === "danger" ? TOUCH.cancel : TOUCH.key}
                color={tone === "main" ? "#fff" : tone === "danger" ? TOUCH.dangerText : TOUCH.text}
                onClick={choice.onPick}
                style={{ height: 64, fontSize: 18, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
              >
                {choice.label}
              </TouchButton>
            );
          })}
        </div>
      </div>
    </div>
  );
}
