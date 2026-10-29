"use client";

import Link from "next/link";
import { useToggleState } from "@/components/layout/hooks";
import { REPORT_ACCENT } from "@/components/reports/accent";

// The design's small purple row button (Stock Reports → "Reports").
export default function ReportLinkButton({ href, label }: { href: string; label: string }) {
  const hover = useToggleState();

  return (
    <Link
      href={href}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 34,
        padding: "0 18px",
        display: "inline-flex",
        alignItems: "center",
        background: hover.value ? REPORT_ACCENT.hover : REPORT_ACCENT.background,
        borderRadius: 8,
        fontSize: 12.5,
        fontWeight: 600,
        color: "#fff",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
