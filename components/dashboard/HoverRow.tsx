"use client";

import type { CSSProperties, ReactNode } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

export default function HoverRow({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const hover = useToggleState();

  return (
    <div
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ ...style, background: hover.value ? COLORS.bgApp : style.background ?? "transparent" }}
    >
      {children}
    </div>
  );
}
