"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

export default function GhostButton({
  children,
  href,
  onClick,
  type = "button",
  paddingX = 24,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  paddingX?: number;
}) {
  const hover = useToggleState();

  const style: CSSProperties = {
    height: 40,
    padding: `0 ${paddingX}px`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: hover.value ? COLORS.bgApp : "#fff",
    border: `1px solid ${COLORS.borderStrong}`,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    color: COLORS.text,
    cursor: "pointer",
    textDecoration: "none",
    transition: "background .12s",
  };

  if (href) {
    return (
      <Link href={href} style={style} onMouseEnter={hover.on} onMouseLeave={hover.off}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
      {children}
    </button>
  );
}
