"use client";

import type { CSSProperties } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { REPORT_ACCENT } from "@/components/reports/accent";

// EXCEL — a plain <a> (not next/link: prefetching would build the workbook).
// The route answers with an attachment, so the page stays put.
export default function ReportExcelLink({ href, style }: { href: string; style: CSSProperties }) {
  const hover = useToggleState();

  return (
    <a
      href={href}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ ...style, background: hover.value ? REPORT_ACCENT.hover : REPORT_ACCENT.background, cursor: "pointer" }}
    >
      EXCEL
    </a>
  );
}
