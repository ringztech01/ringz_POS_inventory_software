import { Decimal } from "@prisma/client/runtime/index-browser";

// The POS calculator's logic: a plain four-function calculator (like a desk
// calculator: operators apply left to right, no precedence). Exact decimal
// arithmetic — the same decimal.js lib/pricing.ts uses — so 0.1 + 0.2 is 0.3.

export type Operator = "+" | "−" | "×" | "÷";

export type CalcKey =
  | { type: "digit"; digit: string }
  | { type: "dot" }
  | { type: "operator"; operator: Operator }
  | { type: "equals" }
  | { type: "percent" }
  | { type: "backspace" }
  | { type: "clear" };

export type CalcState = {
  // What the screen shows: the number being typed or the last result.
  display: string;
  // The left-hand number and operator waiting for the right-hand one.
  stored: string | null;
  operator: Operator | null;
  // The next digit starts a new number (after an operator, = or an error).
  fresh: boolean;
  error: boolean;
};

export const INITIAL: CalcState = { display: "0", stored: null, operator: null, fresh: true, error: false };

// Longest number that can be typed (digits, not counting "-" and ".").
const MAX_DIGITS = 15;

// A Decimal as a plain string: no exponent, at most 10 decimal places,
// trailing zeros dropped.
export function plain(value: Decimal): string {
  const fixed = value.toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed();
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function apply(left: string, operator: Operator, right: string): string | null {
  const a = new Decimal(left);
  const b = new Decimal(right);
  switch (operator) {
    case "+":
      return plain(a.plus(b));
    case "−":
      return plain(a.minus(b));
    case "×":
      return plain(a.times(b));
    case "÷":
      return b.isZero() ? null : plain(a.div(b));
  }
}

const errorState: CalcState = { ...INITIAL, display: "Error", error: true };

export function press(state: CalcState, key: CalcKey): CalcState {
  // After an error only digits, "." and C do anything (they start over).
  if (state.error && key.type !== "digit" && key.type !== "dot" && key.type !== "clear") return state;
  const base = state.error ? INITIAL : state;

  switch (key.type) {
    case "digit": {
      if (base.fresh || base.display === "0") return { ...base, display: key.digit, fresh: false };
      if (base.display.replace(/[-.]/g, "").length >= MAX_DIGITS) return base;
      return { ...base, display: base.display + key.digit };
    }
    case "dot": {
      if (base.fresh) return { ...base, display: "0.", fresh: false };
      return base.display.includes(".") ? base : { ...base, display: base.display + "." };
    }
    case "operator": {
      // A second operator in a row just replaces the first.
      if (base.operator && base.fresh) return { ...base, operator: key.operator };
      if (base.operator && base.stored !== null) {
        const result = apply(base.stored, base.operator, base.display);
        if (result === null) return errorState;
        return { display: result, stored: result, operator: key.operator, fresh: true, error: false };
      }
      return { ...base, stored: base.display, operator: key.operator, fresh: true };
    }
    case "equals": {
      if (!base.operator || base.stored === null) return { ...base, fresh: true };
      const result = apply(base.stored, base.operator, base.display);
      if (result === null) return errorState;
      return { display: result, stored: null, operator: null, fresh: true, error: false };
    }
    case "percent":
      return { ...base, display: plain(new Decimal(base.display).div(100)), fresh: true };
    case "backspace": {
      if (base.fresh) return base;
      const next = base.display.slice(0, -1);
      return { ...base, display: next === "" || next === "-" ? "0" : next };
    }
    case "clear":
      return INITIAL;
  }
}

// The screen text: thousands separators on the whole part, the typed
// decimals kept as typed ("12." stays "12.").
export function formatDisplay(display: string): string {
  if (display === "Error") return display;
  const negative = display.startsWith("-");
  const [whole, fraction] = (negative ? display.slice(1) : display).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

// A key press → a calculator key (null for keys the calculator ignores).
export function keyFromKeyboard(key: string): CalcKey | null {
  if (/^\d$/.test(key)) return { type: "digit", digit: key };
  switch (key) {
    case ".":
    case ",":
      return { type: "dot" };
    case "+":
      return { type: "operator", operator: "+" };
    case "-":
      return { type: "operator", operator: "−" };
    case "*":
    case "x":
    case "X":
      return { type: "operator", operator: "×" };
    case "/":
      return { type: "operator", operator: "÷" };
    case "Enter":
    case "=":
      return { type: "equals" };
    case "%":
      return { type: "percent" };
    case "Backspace":
      return { type: "backspace" };
    case "Delete":
    case "c":
    case "C":
      return { type: "clear" };
    default:
      return null;
  }
}
