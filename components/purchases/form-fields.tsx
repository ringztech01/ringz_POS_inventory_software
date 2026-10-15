"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

// Inputs shared by the purchase form and its line modal (and, later, Sales).

export type SelectOption = { value: string; label: string };

// Money/percent fields accept digits with up to 2 decimals while typing;
// anything else is rejected at the keystroke rather than parsed later.
export function isDecimalInput(value: string): boolean {
  return /^\d{0,10}(\.\d{0,2})?$/.test(value);
}

export function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} {required && <span style={{ color: COLORS.danger }}>*</span>}
      </label>
      {children}
      {error && <span style={{ fontSize: 12, color: COLORS.danger }}>{error}</span>}
    </div>
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  hasError,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  hasError?: boolean;
}) {
  const focus = useToggleState();

  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          appearance: "none",
          width: "100%",
          height: 40,
          border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 36px 0 12px",
          fontSize: 14,
          background: "#fff",
          color: value ? COLORS.ink : COLORS.slateLight,
          cursor: "pointer",
          outline: "none",
          boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        }}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} style={{ color: COLORS.ink }}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.8}
        color={COLORS.slateMid}
        style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none" }}
      />
    </div>
  );
}

export function DateInput({
  value,
  onChange,
  hasError,
}: {
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
}) {
  const focus = useToggleState();

  return (
    <input
      type="date"
      value={value}
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

// Mono decimal input. With `suffix` it renders the design's joined "input | %"
// / "input | ₦" pair; without, a plain bordered input.
export function DecimalInput({
  value,
  onChange,
  suffix,
  placeholder = "0.00",
  hasError,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
  hasError?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const focus = useToggleState();
  const borderColor = hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong;

  const input = (
    <input
      inputMode="decimal"
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(event) => {
        if (isDecimalInput(event.target.value)) onChange(event.target.value);
      }}
      onFocus={focus.on}
      onBlur={focus.off}
      style={{
        // flex:1 only in the row beside the suffix — inside Field's column
        // flexbox it would collapse the input's height.
        flex: suffix ? 1 : undefined,
        minWidth: 0,
        width: suffix ? undefined : "100%",
        height: 40,
        // Longhands only: React warns when a shorthand (border) and a
        // longhand (borderRight) for the same property change on rerender.
        borderStyle: "solid",
        borderColor,
        borderWidth: suffix ? "1px 0 1px 1px" : 1,
        borderRadius: suffix ? "8px 0 0 8px" : 8,
        padding: "0 12px",
        fontSize: 14,
        fontFamily: FONTS.mono,
        outline: "none",
        boxShadow: !suffix && focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
      }}
    />
  );

  if (!suffix) return input;

  return (
    <div style={{ display: "flex" }}>
      {input}
      <span
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          background: COLORS.bgApp,
          border: `1px solid ${hasError ? COLORS.danger : COLORS.borderStrong}`,
          borderRadius: "0 8px 8px 0",
          fontSize: 13,
          fontWeight: 600,
          color: COLORS.slate,
        }}
      >
        {suffix}
      </span>
    </div>
  );
}
