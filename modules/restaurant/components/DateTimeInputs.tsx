"use client";

import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

type Props = { value: string; onChange: (value: string) => void; hasError?: boolean; min?: string; ariaLabel: string };

function NativeInput({ type, value, onChange, hasError, min, ariaLabel }: Props & { type: "date" | "time" }) {
  const focus = useToggleState();
  return (
    <input
      type={type}
      value={value}
      min={min}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onFocus={focus.on}
      onBlur={focus.off}
      style={{
        width: "100%",
        height: 40,
        border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        fontFamily: FONTS.mono,
        outline: "none",
        boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
      }}
    />
  );
}

// "YYYY-MM-DD", styled like the app's date fields; `min` greys out earlier days.
export function DateField(props: Props) {
  return <NativeInput type="date" {...props} />;
}

// "HH:MM" (24-hour).
export function TimeField(props: Props) {
  return <NativeInput type="time" {...props} />;
}
