"use client";

import { useState } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

// Most digits a quantity can be typed with (the forms cap it anyway).
const MAX_DIGITS = 7;

// The number box between a quantity stepper's − and + buttons. The buttons
// still step by one; clicking the box lets you type a quantity directly
// (digits only), so large numbers don't take hundreds of clicks.
//
// While typing, the box may be empty (to retype a number) — it snaps back to
// the current quantity on blur. Each typed value goes straight to onChange,
// which clamps it (≥ 1, and the form's own max). Enter just commits — it
// doesn't submit the surrounding form.
export default function QtyInput({
  value,
  onChange,
  ariaLabel,
  hasError,
}: {
  value: number;
  onChange: (quantity: number) => void;
  ariaLabel: string;
  hasError?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const focus = useToggleState();
  const text = draft ?? String(value);
  const borderColor = hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong;

  return (
    <input
      value={text}
      inputMode="numeric"
      aria-label={ariaLabel}
      onFocus={(event) => {
        focus.on();
        // Select the number so typing replaces it.
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS);
        setDraft(digits);
        if (digits !== "") onChange(Number(digits));
      }}
      onBlur={() => {
        focus.off();
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      style={{
        // The design's 48px, widening for longer numbers.
        width: Math.max(48, text.length * 8 + 16),
        height: 32,
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        borderLeft: "none",
        borderRight: "none",
        padding: "0 4px",
        textAlign: "center",
        fontFamily: FONTS.mono,
        fontSize: 13,
        outline: "none",
        background: "#fff",
        cursor: "text",
      }}
    />
  );
}
