"use client";

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { useToggleState } from "@/components/layout/hooks";

// A button with the design's hover state (`hoverStyle` is merged over `style`
// while hovered and enabled).
export default function PosButton({
  style,
  hoverStyle,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { style: CSSProperties; hoverStyle?: CSSProperties }) {
  const hover = useToggleState();

  return (
    <button
      type="button"
      {...props}
      disabled={disabled}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .12s, color .12s",
        ...style,
        ...(hover.value && !disabled ? hoverStyle : null),
        ...(disabled ? { opacity: 0.55 } : null),
      }}
    />
  );
}
