"use client";

import { useEffect, useRef, useState } from "react";
import { asQuantity, typeDigit } from "../../lib/posSpeed";
import { TOUCH } from "../../lib/theme";
import { panelStyle } from "./PanelFrame";
import TouchButton from "./TouchButton";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"];

// The Qty pad in the grid's place (the Restaurant POS design): type a
// number, OK — the next dish tapped goes on that many times. Or "Add by
// code": the dish with that code (301 for DM-301) straight on. A desk
// keyboard types too: digits, Backspace, Enter for the code, * or x for the
// quantity. Esc (or Back on the crumb bar) closes it.
export default function QtyPanel({ initial, onQuantity, onCode, onCancel }: { initial: string; onQuantity: (quantity: number) => void; onCode: (code: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const latest = useRef(value);
  const update = (next: string) => {
    latest.current = next;
    setValue(next);
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const now = latest.current;
      if (event.key === "Escape") onCancel();
      else if (/^\d$/.test(event.key)) update(typeDigit(now, event.key));
      else if (event.key === "Backspace") update(now.slice(0, -1));
      else if (event.key === "Enter" && now) onCode(now);
      else if ((event.key === "*" || event.key.toLowerCase() === "x") && asQuantity(now)) onQuantity(asQuantity(now)!);
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCode, onQuantity, onCancel]);

  function press(key: string) {
    if (key === "C") update("");
    else if (key === "OK") onQuantity(asQuantity(latest.current) ?? 1);
    else update(typeDigit(latest.current, key));
  }

  return (
    <div role="dialog" aria-label="Quantity or code" data-pos-panel style={{ ...panelStyle, alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ width: 340, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: TOUCH.textDim }}>Quantity for next item</span>
        <span data-qty-value style={{ height: 60, background: TOUCH.check, color: TOUCH.ink, borderRadius: TOUCH.radius, display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 16px", fontFamily: TOUCH.display, fontSize: 32, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {value || "1"}
        </span>
        <div role="group" aria-label="Number pad" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: TOUCH.gap }}>
          {KEYS.map((key) => (
            <TouchButton
              key={key}
              data-pad={key}
              data-qty-set={key === "OK" || undefined}
              aria-label={key === "C" ? "Clear" : key === "OK" ? "OK — the next dish this many times" : key}
              background={key === "OK" ? TOUCH.teal : key === "C" ? TOUCH.clear : TOUCH.key}
              onClick={() => press(key)}
              style={{ height: 62, fontFamily: TOUCH.display, fontSize: 24, fontWeight: 700 }}
            >
              {key}
            </TouchButton>
          ))}
        </div>
        <TouchButton data-qty-code background={TOUCH.key} disabled={!value} onClick={() => value && onCode(value)} style={{ height: 48, fontSize: 15, fontWeight: 700, opacity: value ? 1 : 0.45 }}>
          Add by code{value ? ` ${value}` : ""}
        </TouchButton>
      </div>
    </div>
  );
}
