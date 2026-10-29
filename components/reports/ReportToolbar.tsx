import { Suspense } from "react";
import SearchInput from "@/components/ui/SearchInput";
import PurchaseFilters from "@/components/purchases/PurchaseFilters";
import ReportDatePicker from "@/components/reports/ReportDatePicker";
import ReportExcelLink from "@/components/reports/ReportExcelLink";
import { REPORT_ACCENT } from "@/components/reports/accent";
import type { FormOption } from "@/app/(dashboard)/purchases/types";


// Search (?q=) on the left; the date-range Filters button and EXCEL on the
// right (RingzPOS Reports design). `excelHref` is the export of the CURRENT
// filters; without it the button is shown disabled. `warehouses` adds the
// warehouse choice to the Filters panel (reports without a warehouse select);
// `datePicker` adds the design's "Select Date" box after EXCEL; `filters={false}`
// drops the Filters button (Stock Reports: search + EXCEL only).
export default function ReportToolbar({
  searchWidth = 340,
  searchHeight = 38,
  filterWidth = 40,
  warehouses,
  datePicker = false,
  filters = true,
  excelHref,
}: {
  searchWidth?: number;
  searchHeight?: number;
  filterWidth?: number;
  warehouses?: FormOption[];
  datePicker?: boolean;
  filters?: boolean;
  excelHref?: string;
}) {
  const excelStyle = {
    height: 40,
    padding: "0 20px",
    display: "flex",
    alignItems: "center",
    background: REPORT_ACCENT.background,
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: ".04em",
    color: "#fff",
    textDecoration: "none",
  } as const;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <Suspense fallback={null}>
        <SearchInput placeholder="Search" width={searchWidth} height={searchHeight} />
      </Suspense>
      <div style={{ display: "flex", gap: 10 }}>
        {filters && (
          <Suspense fallback={null}>
            <PurchaseFilters warehouses={warehouses} iconTrigger={{ ...REPORT_ACCENT, width: filterWidth }} />
          </Suspense>
        )}
        {excelHref ? (
          <ReportExcelLink href={excelHref} style={excelStyle} />
        ) : (
          <span title="Excel export isn't available here" style={{ ...excelStyle, opacity: 0.55, cursor: "not-allowed" }}>
            EXCEL
          </span>
        )}
        {datePicker && (
          <Suspense fallback={null}>
            <ReportDatePicker />
          </Suspense>
        )}
      </div>
    </div>
  );
}
