"use client";

import { useSearchParams } from "next/navigation";
import { FileSpreadsheet, Printer } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import type { ReportTabKey } from "../../lib/reportTabs";

const button = {
  height: 36,
  padding: "0 12px",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  background: "#fff",
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
} as const;

// Restaurant Reports' Export to Excel (this tab, the URL's filters, sorting
// and grouping — server/reportExportRoute.ts) and Print (A4: the browser's
// print dialog, the report laid out for the page; pick the Reports printer).
export default function ReportActions({ tab, reportsPrinter }: { tab: ReportTabKey; reportsPrinter: string | null }) {
  const query = useSearchParams().toString();
  const href = `/restaurant/reports/export/${tab}${query ? `?${query}` : ""}`;
  const printTitle = reportsPrinter ? `Opens the print dialog: pick “${reportsPrinter}” (the Reports printer)` : "Opens the print dialog (no Reports printer is set in Settings › Printers: pick any A4 printer)";
  return (
    <div data-no-print data-report-actions style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <a href={href} data-report-export={tab} download style={button} title="This tab as an Excel workbook, as filtered and sorted here">
        <FileSpreadsheet size={15} strokeWidth={1.7} />
        Export to Excel
      </a>
      <button type="button" data-report-printbutton onClick={() => window.print()} style={button} title={printTitle}>
        <Printer size={15} strokeWidth={1.7} />
        Print (A4)
      </button>
      {reportsPrinter && (
        <span data-reports-printer style={{ fontSize: 12, color: COLORS.slateMid }}>
          Reports printer: {reportsPrinter}
        </span>
      )}
    </div>
  );
}
