"use client";

import { Delete } from "lucide-react";
import { TOUCH } from "../../lib/theme";
import TouchButton from "./TouchButton";

const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL'", "ZXCVBNM,.-"];

// The touch POS's keyboard (no system keyboard popping up over the screen):
// digits, letters and a little punctuation, Space, Delete and Clear. Fills
// the height it's given.
export default function OnScreenKeyboard({ onKey, onDelete, onClear }: { onKey: (key: string) => void; onDelete: () => void; onClear: () => void }) {
  const key = { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 } as const;
  return (
    <div role="group" aria-label="Keyboard" data-pos-keyboard style={{ display: "grid", gridTemplateRows: "repeat(5, minmax(0,1fr))", gap: TOUCH.gap, minHeight: 0 }}>
      {ROWS.map((row) => (
        <div key={row} style={{ display: "grid", gridTemplateColumns: "repeat(10, minmax(0,1fr))", gap: TOUCH.gap }}>
          {[...row].map((char) => (
            <TouchButton key={char} data-key={char} aria-label={char} background={TOUCH.key} onClick={() => onKey(/[A-Z]/.test(char) ? char.toLowerCase() : char)} style={key}>
              {char}
            </TouchButton>
          ))}
        </div>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 6fr 2fr", gap: TOUCH.gap }}>
        <TouchButton background={TOUCH.raised} onClick={onClear} style={{ ...key, fontSize: 15 }}>
          Clear
        </TouchButton>
        <TouchButton data-key="space" aria-label="Space" background={TOUCH.key} onClick={() => onKey(" ")} style={{ ...key, fontSize: 15 }}>
          Space
        </TouchButton>
        <TouchButton aria-label="Delete" background={TOUCH.raised} onClick={onDelete} style={key}>
          <Delete size={22} strokeWidth={2.2} />
        </TouchButton>
      </div>
    </div>
  );
}
