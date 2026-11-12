"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { TOUCH } from "../../lib/theme";

// A flat, solid touch-POS key: 4 px corners, no border, and an instant
// pressed state (the moment a finger lands, before any work) — a plain dark
// key lifts to the pressed grey, a coloured one darkens (the Restaurant POS
// design's style-active).
export default function TouchButton({
  background,
  color = "#fff",
  pressedBackground,
  style,
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "type"> & { background: string; color?: string; pressedBackground?: string; style?: CSSProperties }) {
  const [pressed, setPressed] = useState(false);
  const lift = pressedBackground ?? (background === TOUCH.key || background === TOUCH.raised ? TOUCH.keyDown : undefined);
  return (
    <button
      type="button"
      data-lift={lift ? "" : undefined}
      {...rest}
      disabled={disabled}
      onPointerDown={(event) => {
        if (!disabled) setPressed(true);
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        setPressed(false);
        onPointerUp?.(event);
      }}
      onPointerLeave={(event) => {
        setPressed(false);
        onPointerLeave?.(event);
      }}
      onPointerCancel={(event) => {
        setPressed(false);
        onPointerCancel?.(event);
      }}
      style={{
        background: pressed && lift ? lift : background,
        color,
        border: "none",
        borderRadius: TOUCH.radius,
        padding: 0,
        margin: 0,
        font: "inherit",
        cursor: disabled ? "default" : "pointer",
        filter: pressed && !lift ? "brightness(0.8)" : undefined,
        touchAction: "manipulation",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
