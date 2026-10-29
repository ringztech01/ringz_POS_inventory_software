import { Suspense } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { formatDateTime, formatNaira } from "@/lib/format";
import { parseReportParams, REPORT_PER_PAGE_OPTIONS, reportExportHref, type ReportSearchParams } from "@/lib/reports/params";
import { getPurchaseReport, getReportWarehouses } from "@/lib/reports/queries";
import { COLORS, FONTS } from "@/components/layout/theme";
import Pagination from "@/components/ui/Pagination";
import { PaymentTypePill, PurchaseStatusPill } from "@/components/purchases/purchase-display";
import type { PurchaseListRow } from "@/app/(dashboard)/purchases/queries";
import ReportToolbar from "@/components/reports/ReportToolbar";
import ReportTable, { MoneyCell, ReferenceCell, TextCell, type ReportColumn } from "@/components/reports/ReportTable";

// Purchases don't record payments (no stored paid / due amounts), so these
// cells say so rather than inventing a figure.
const notRecorded = <span style={{ fontSize: 13, color: COLORS.slateLight }}>—</span>;

// Design grid (RingzPOS Reports.dc.html → PURCHASE REPORTS).
const PURCHASE_COLUMNS: ReportColumn<PurchaseListRow>[] = [
  { label: "Reference", width: "130px", render: (row) => <ReferenceCell value={row.reference} /> },
  { label: "Supplier", width: "minmax(140px,1fr)", render: (row) => <TextCell value={row.party.name} muted /> },
  { label: "Status", width: "130px", render: (row) => <PurchaseStatusPill status={row.status} /> },
  {
    label: "Grand total",
    width: "150px",
    align: "right",
    render: (row) => <MoneyCell value={formatNaira(row.grandTotal)} strong />,
  },
  { label: "Paid", width: "130px", align: "right", render: () => notRecorded },
  { label: "Due", width: "130px", align: "right", render: () => notRecorded },
  { label: "Payment type", width: "160px", render: (row) => <PaymentTypePill paymentType={row.paymentType} /> },
  {
    label: "Created on",
    width: "150px",
    // The design's blue time / date chip; same formatDateTime as the list.
    render: (row) => {
      const createdOn = formatDateTime(row.createdAt);
      return (
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            fontFamily: FONTS.mono,
            fontSize: 11.5,
            color: "#1a5c93",
            background: "#e6f1fb",
            border: "1px solid #cfe2f4",
            padding: "5px 10px",
            borderRadius: 8,
            lineHeight: 1.35,
          }}
        >
          <span>{createdOn.time}</span>
          <span>{createdOn.date}</span>
        </span>
      );
    },
  },
];

// /reports/purchase — every purchase matching the URL's search, date range
// ("Select Date" or Filters) and warehouse (Filters), paginated. Same rows and
// total as the Purchases list for the same filters.
export default async function PurchaseReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  const params = await searchParams;
  const { warehouses, selected } = await getReportWarehouses(params.warehouse);
  // An unknown/deleted warehouse id falls back to all warehouses.
  const filters = { ...parseReportParams(params), warehouseId: selected?.id };
  const { rows, total } = await getPurchaseReport(filters);
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
          excelHref={reportExportHref("purchase", filters)}
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
          columns={PURCHASE_COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          minWidth={1120}
          rowHeight={60}
          flush
          emptyMessage={selected ? `No purchases found in ${selected.name}.` : "No purchases found."}
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
