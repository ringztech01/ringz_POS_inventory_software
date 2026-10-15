"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

type Tone = "default" | "danger";

const TONE_HOVER: Record<Tone, { bg: string; color: string; border: string }> = {
  default: { bg: COLORS.tealTint, color: COLORS.teal, border: COLORS.tealBorder },
  danger: { bg: COLORS.dangerBg, color: COLORS.danger, border: COLORS.dangerBorder },
};

export default function IconActionButton({
  icon,
  title,
  href,
  onClick,
  tone = "default",
  baseColor,
  disabled,
  size = 32,
}: {
  // A rendered icon element (e.g. <Eye size={15} />), not a component
  // reference — this can be passed from a Server Component parent into this
  // Client Component. A raw component reference (icon: LucideIcon) cannot:
  // Next.js rejects passing unrendered functions across that boundary.
  icon: ReactNode;
  title: string;
  href?: string;
  onClick?: () => void;
  tone?: Tone;
  baseColor?: string;
  disabled?: boolean;
  size?: number;
}) {
  const hover = useToggleState();
  const hoverStyle = TONE_HOVER[tone];
  const isHovered = hover.value && !disabled;

  const style = {
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: isHovered ? hoverStyle.bg : "#fff",
    border: `1px solid ${isHovered ? hoverStyle.border : COLORS.borderStrong}`,
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? COLORS.slateLight : isHovered ? hoverStyle.color : (baseColor ?? COLORS.slate),
    transition: "background .12s",
    textDecoration: "none",
  } as const;

  if (href && !disabled) {
    return (
      <Link href={href} title={title} onMouseEnter={hover.on} onMouseLeave={hover.off} style={style}>
        {icon}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={style}
    >
      {icon}
    </button>
  );
}
