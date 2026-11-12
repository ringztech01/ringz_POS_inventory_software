"use client";

import { useEffect } from "react";
import { TOUCH } from "../../lib/theme";
import TouchButton from "./TouchButton";

export type MoreItem = { label: string; onClick: () => void; danger?: boolean; hidden?: boolean };

// More… — the less-used functions as a column of big keys above the key
// (and Full screen / Exit POS, which the header leaves out). A tap outside
// (or Esc) closes it.
export default function MoreMenu({ items, onClose }: { items: MoreItem[]; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = items.filter((item) => !item.hidden);
  return (
    <>
      <div aria-hidden onPointerDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div
        role="menu"
        aria-label="More functions"
        style={{ position: "absolute", bottom: "calc(100% + 12px)", left: 0, zIndex: 41, width: 280, padding: TOUCH.gap, background: TOUCH.header, border: `1px solid ${TOUCH.line}`, borderRadius: TOUCH.radius, display: "flex", flexDirection: "column", gap: TOUCH.gap }}
      >
        {shown.map((item) => (
          <TouchButton
            key={item.label}
            role="menuitem"
            background={item.danger ? TOUCH.void : TOUCH.key}
            pressedBackground={item.danger ? TOUCH.voidDown : TOUCH.keyDown}
            onClick={() => {
              onClose();
              item.onClick();
            }}
            style={{ height: 52, padding: "0 16px", textAlign: "left", fontSize: 16, fontWeight: 700, marginTop: item.danger ? 10 : 0 }}
          >
            {item.label}
          </TouchButton>
        ))}
      </div>
    </>
  );
}
