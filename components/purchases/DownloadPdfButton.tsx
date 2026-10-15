"use client";

import { FileText } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

// Plain anchor (not next/link): the PDF is a route handler response.
export default function DownloadPdfButton({ href }: { href: string }) {
  const hover = useToggleState();

  return (
    <a
      href={href}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 40,
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: hover.value ? COLORS.focusRing : COLORS.tealTint,
        border: `1px solid ${COLORS.focusRing}`,
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: COLORS.tealDark,
        cursor: "pointer",
        textDecoration: "none",
        transition: "background .12s",
      }}
    >
      <FileText size={15} strokeWidth={1.7} />
      Download PDF
    </a>
  );
}
