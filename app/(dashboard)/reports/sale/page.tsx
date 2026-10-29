import { Suspense } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { formatNaira } from "@/lib/format";
import { parseReportParams, REPORT_PER_PAGE_OPTIONS, reportExportHref, type ReportSearchParams } from "@/lib/reports/params";
import { getReportWarehouses, getSaleReport } from "@/lib/reports/queries";
import { COLORS } from "@/components/layout/theme";
import Pagination from "@/components/ui/Pagination";
import { PaymentStatusPill, PurchaseStatusPill } from "@/components/purchases/purchase-display";
import type { PurchaseDocumentRow } from "@/components/purchases/PurchaseTable";
import ReportToolbar from "@/components/reports/ReportToolbar";
import ReportTable, { MoneyCell, ReferenceCell, TextCell, type ReportColumn } from "@/components/reports/ReportTable";

// Design grid (RingzPOS Reports.dc.html → SALE REPORTS). Values are the Sales
// list's (stored paid / payment status) — nothing is recomputed.
const SALE_COLUMNS: ReportColumn<PurchaseDocumentRow>[] = [
  { label: "Reference", width: "150px", render: (row) => <ReferenceCell value={row.reference} /> },
  { label: "Customer", width: "minmax(180px,1fr)", render: (row) => <TextCell value={row.party.name} /> },
  { label: "Status", width: "150px", render: (row) => <PurchaseStatusPill status={row.status} /> },
  {
    label: "Grand total",
    width: "170px",
    align: "right",
    render: (row) => <MoneyCell value={formatNaira(row.grandTotal)} strong />,
  },
  { label: "Paid", width: "170px", align: "right", render: (row) => <MoneyCell value={formatNaira(row.paid ?? "0")} /> },
  {
    label: "Payment status",
    width: "160px",
    render: (row) => (row.paymentStatus ? <PaymentStatusPill paymentStatus={row.paymentStatus} /> : null),
  },
];

// /reports/sale — every sale matching the URL's search, date range
// ("Select Date" or Filters) and warehouse (Filters), paginated. Same rows and
// total as the Sales list for the same filters.
export default async function SaleReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  const params = await searchParams;
  const { warehouses, selected } = await getReportWarehouses(params.warehouse);
  // An unknown/deleted warehouse id falls back to all warehouses.
  const filters = { ...parseReportParams(params), warehouseId: selected?.id };
  const { rows, total } = await getSaleReport(filters);
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  return (
    <>
      <div style={{ position: "relative", zIndex: 2 }}>
        <ReportToolbar
          searchWidth={360}
          searchHeight={40}
          filterWidth={44}
          warehouses={warehouses}
          datePicker
          excelHref={reportExportHref("sale", filters)}
        />
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          overflow: "hidden",
        }}
      >
        <ReportTable
          columns={SALE_COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          minWidth={1080}
          rowHeight={56}
          flush
          emptyMessage={selected ? `No sales found in ${selected.name}.` : "No sales found."}
        />

        <Suspense fallback={null}>
          <Pagination
            page={filters.page}
            perPage={filters.perPage}
            total={total}
            totalPages={totalPages}
            perPageOptions={REPORT_PER_PAGE_OPTIONS}
            showPageNumbers
          />
        </Suspense>
      </div>
    </>
  );
}
