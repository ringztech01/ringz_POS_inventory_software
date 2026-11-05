"use client";

import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

// A modal form's text field, styled like the app's other modal inputs.
export default function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  hasError,
  autoFocus,
  ariaLabel,
  inputMode,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hasError?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  inputMode?: "text" | "numeric";
}) {
  const focus = useToggleState();
  return (
    <input
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
      onFocus={focus.on}
      onBlur={focus.off}
      style={{
        height: 40,
        border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        outline: "none",
        boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        transition: "border-color .12s, box-shadow .12s",
      }}
    />
  );
}
