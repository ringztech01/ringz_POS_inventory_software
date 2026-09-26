"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

type PrimaryButtonProps = {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  paddingX?: number;
  fontSize?: number;
};

export default function PrimaryButton({
  children,
  href,
  onClick,
  type = "button",
  disabled,
  paddingX = 18,
  fontSize = 13.5,
}: PrimaryButtonProps) {
  const hover = useToggleState();

  const style: CSSProperties = {
    height: 40,
    padding: `0 ${paddingX}px`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: disabled ? COLORS.slateLight : hover.value ? COLORS.tealDark : COLORS.teal,
    border: "none",
    borderRadius: 8,
    fontSize,
    fontWeight: 600,
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
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
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={style}
    >
      {children}
    </button>
  );
}
