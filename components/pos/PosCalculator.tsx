"use client";

import { useEffect, useReducer, type CSSProperties } from "react";
import toast from "react-hot-toast";
import { Copy, Delete, X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatDisplay, INITIAL, keyFromKeyboard, press, type CalcKey } from "./calculator";
import PosButton from "./PosButton";
import { POS } from "./theme";

type Tone = "digit" | "operator" | "clear" | "equals";

const TONES: Record<Tone, { style: CSSProperties; hover: CSSProperties }> = {
  digit: { style: { background: POS.chip, color: COLORS.ink }, hover: { background: POS.chipHover } },
  operator: { style: { background: POS.indigoTint, color: POS.indigo }, hover: { background: POS.indigoTintHover } },
  clear: { style: { background: COLORS.dangerBg, color: COLORS.danger }, hover: { background: "#f8d7d4" } },
  equals: { style: { background: POS.green, color: "#fff" }, hover: { background: POS.greenHover } },
};

// The keypad, row by row (0 spans two columns).
const KEYS: { label: string; aria: string; key: CalcKey; tone: Tone; wide?: boolean }[] = [
  { label: "C", aria: "Clear", key: { type: "clear" }, tone: "clear" },
  { label: "⌫", aria: "Backspace", key: { type: "backspace" }, tone: "operator" },
  { label: "%", aria: "Percent", key: { type: "percent" }, tone: "operator" },
  { label: "÷", aria: "Divide", key: { type: "operator", operator: "÷" }, tone: "operator" },
  ...["7", "8", "9"].map((d) => ({ label: d, aria: d, key: { type: "digit", digit: d } as CalcKey, tone: "digit" as Tone })),
  { label: "×", aria: "Multiply", key: { type: "operator", operator: "×" }, tone: "operator" },
  ...["4", "5", "6"].map((d) => ({ label: d, aria: d, key: { type: "digit", digit: d } as CalcKey, tone: "digit" as Tone })),
  { label: "−", aria: "Subtract", key: { type: "operator", operator: "−" }, tone: "operator" },
  ...["1", "2", "3"].map((d) => ({ label: d, aria: d, key: { type: "digit", digit: d } as CalcKey, tone: "digit" as Tone })),
  { label: "+", aria: "Add", key: { type: "operator", operator: "+" }, tone: "operator" },
  { label: "0", aria: "0", key: { type: "digit", digit: "0" }, tone: "digit", wide: true },
  { label: ".", aria: "Decimal point", key: { type: "dot" }, tone: "digit" },
  { label: "=", aria: "Equals", key: { type: "equals" }, tone: "equals" },
];

// The toolbar's calculator: a panel under the tools that stays open beside
// the till until closed. Works with the mouse or the keyboard (digits, . + -
// * / Enter Backspace %, C/Delete to clear, Esc to close) — except while the
// cashier is typing in a field.
export default function PosCalculator({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(press, INITIAL);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const key = keyFromKeyboard(event.key);
      if (!key) return;
      event.preventDefault();
      dispatch(key);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.display);
      toast.success(`Copied ${formatDisplay(state.display)}`);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Calculator"
      style={{
        position: "fixed",
        top: 100,
        right: 32,
        zIndex: 60,
        width: 312,
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)",
        border: `1px solid ${COLORS.border}`,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        animation: "elv-pop .12s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FONTS.display, fontSize: 16, fontWeight: 600 }}>Calculator</span>
        <span style={{ display: "flex", gap: 4 }}>
          <PosButton
            title="Copy result"
            aria-label="Copy result"
            onClick={copy}
            disabled={state.error}
            style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
          >
            <Copy size={15} strokeWidth={1.7} />
          </PosButton>
          <PosButton
            title="Close"
            aria-label="Close calculator"
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
          >
            <X size={16} strokeWidth={1.8} />
          </PosButton>
        </span>
      </div>

      <div
        style={{
          background: POS.searchBg,
          borderRadius: 12,
          padding: "10px 14px",
          textAlign: "right",
          minHeight: 76,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <span aria-label="Pending" style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slateMid, minHeight: 18 }}>
          {state.operator && state.stored !== null ? `${formatDisplay(state.stored)} ${state.operator}` : ""}
        </span>
        <span
          aria-label="Display"
          aria-live="polite"
          style={{
            fontFamily: FONTS.mono,
            fontSize: state.display.length > 12 ? 22 : 30,
            fontWeight: 600,
            color: state.error ? COLORS.danger : COLORS.ink,
            overflowWrap: "anywhere",
            lineHeight: 1.2,
          }}
        >
          {formatDisplay(state.display)}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {KEYS.map(({ label, aria, key, tone, wide }) => (
          <PosButton
            key={aria}
            aria-label={aria}
            onClick={() => dispatch(key)}
            style={{
              ...TONES[tone].style,
              gridColumn: wide ? "span 2" : undefined,
              height: 52,
              borderRadius: 11,
              fontSize: label === "⌫" ? 0 : 20,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            hoverStyle={TONES[tone].hover}
          >
            {label === "⌫" ? <Delete size={19} strokeWidth={1.7} /> : label}
          </PosButton>
        ))}
      </div>
    </div>
  );
}
