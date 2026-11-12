"use client";

import type { CSSProperties, ReactNode } from "react";
import { TOUCH } from "../../lib/theme";
import TouchButton from "./TouchButton";

export type FnKey = {
  // The key's name (data-fn) — and its text unless `text` says otherwise.
  label: string;
  text?: string;
  // Under the text, smaller (Pay's total).
  sub?: string;
  // send: lit (orange) when there's something to send, grey otherwise.
  tone?: "plain" | "void" | "send" | "sendIdle" | "pay" | "lock";
  onClick?: () => void;
  // Not for this user or this order: an empty slot — the keys either side
  // stay exactly where they are.
  hidden?: boolean;
  // A key that isn't a plain button (Print bill: a link or a print queue).
  render?: (style: CSSProperties, content: ReactNode) => ReactNode;
  // Drawn above the key (the More… menu).
  popover?: ReactNode;
};

const TONE: Record<NonNullable<FnKey["tone"]>, { background: string; pressed?: string }> = {
  plain: { background: TOUCH.key, pressed: TOUCH.keyDown },
  void: { background: TOUCH.void, pressed: TOUCH.voidDown },
  send: { background: TOUCH.send },
  sendIdle: { background: TOUCH.sendIdle },
  pay: { background: TOUCH.pay, pressed: TOUCH.payDown },
  lock: { background: TOUCH.cancel },
};

export const keyStyle = (background: string): CSSProperties => ({
  background,
  color: "#fff",
  border: "none",
  borderRadius: TOUCH.radius,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  textDecoration: "none",
  position: "relative",
  touchAction: "manipulation",
  userSelect: "none",
  fontSize: 15,
  fontWeight: 700,
  whiteSpace: "nowrap",
});

function Key({ spec }: { spec: FnKey }) {
  if (spec.hidden) return <div aria-hidden />;
  const tone = TONE[spec.tone ?? "plain"];
  const big = spec.tone === "send" || spec.tone === "sendIdle" || spec.tone === "pay" || spec.tone === "lock";
  const content = (
    <>
      <span style={big ? { fontFamily: TOUCH.display, fontSize: spec.tone === "pay" ? 20 : spec.tone === "lock" ? 18 : 19, fontWeight: 700 } : undefined}>{spec.text ?? spec.label}</span>
      {spec.sub && <span style={{ fontFamily: TOUCH.mono, fontSize: 13, fontWeight: 600, opacity: 0.9, fontVariantNumeric: "tabular-nums" }}>{spec.sub}</span>}
    </>
  );
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      {spec.render ? (
        spec.render(keyStyle(tone.background), content)
      ) : (
        <TouchButton data-fn={spec.label} background={tone.background} color={spec.tone === "lock" ? TOUCH.dangerText : "#fff"} pressedBackground={tone.pressed} onClick={spec.onClick} style={{ ...keyStyle(tone.background), ...(spec.tone === "lock" ? { color: TOUCH.dangerText } : {}) }}>
          {content}
        </TouchButton>
      )}
      {spec.popover}
    </div>
  );
}

// The touch POS's function bar (the Restaurant POS design), fixed along the
// bottom: Tables · Seat · Qty · Note · Hold · Void · More… on the left, then
// Print bill · Split · SEND · PAY — Send orange while there's something to
// send, Pay the biggest, in green, with the total. Keys hidden from this
// user leave their slot empty so nothing moves.
// `wide`: one wide last key of that many shares instead (the tables
// screen's LOCK).
export default function FunctionBar({ left, right, wide }: { left: FnKey[]; right: FnKey[]; wide?: number }) {
  return (
    <nav
      aria-label="Functions"
      data-pos-functions
      style={{
        display: "grid",
        gridTemplateColumns: wide
          ? `repeat(${left.length}, minmax(0,1fr)) 6px repeat(${Math.max(right.length - 1, 0)}, minmax(0,1fr)) minmax(0,${wide}fr)`
          : `repeat(${left.length}, minmax(0,1fr)) 6px repeat(${Math.max(right.length - 2, 0)}, minmax(0,1fr)) minmax(0,1.3fr) minmax(0,1.6fr)`,
        gap: TOUCH.gap,
        padding: TOUCH.gap,
        background: TOUCH.header,
        borderTop: `1px solid ${TOUCH.line}`,
        minWidth: 0,
      }}
    >
      {left.map((spec) => (
        <Key key={spec.label} spec={spec} />
      ))}
      <div aria-hidden />
      {right.map((spec) => (
        <Key key={spec.label} spec={spec} />
      ))}
    </nav>
  );
}
