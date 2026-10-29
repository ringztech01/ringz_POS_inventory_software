import { Suspense } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { formatNaira } from "@/lib/format";
import { parseReportParams, REPORT_PER_PAGE_OPTIONS, reportExportHref, type ReportSearchParams } from "@/lib/reports/params";
import {
  getReportWarehouses,
  getWarehouseReportCounts,
  getWarehouseReportTable,
  parseWarehouseReportTab,
  WAREHOUSE_REPORT_TABS,
} from "@/lib/reports/queries";
import { COLORS, FONTS } from "@/components/layout/theme";
import Pagination from "@/components/ui/Pagination";
import { PaymentStatusPill, PaymentTypePill, PurchaseStatusPill } from "@/components/purchases/purchase-display";
import type { PurchaseDocumentRow } from "@/components/purchases/PurchaseTable";
import type { ExpenseRow } from "@/components/expenses/ExpenseTable";
import ReportWarehouseSelect from "@/components/reports/ReportWarehouseSelect";
import ReportCountTiles from "@/components/reports/ReportCountTiles";
import ReportSubTabs from "@/components/reports/ReportSubTabs";
import ReportToolbar from "@/components/reports/ReportToolbar";
import ReportTable, { MoneyCell, ReferenceCell, TextCell, type ReportColumn } from "@/components/reports/ReportTable";

// Design grid for the document sub-tabs (RingzPOS Reports.dc.html).
const DOC_WIDTHS = ["130px", "minmax(160px,1fr)", "130px", "130px", "150px", "150px", "130px", "140px"];

// Sales / Sales Returns / Purchases Returns share the layout; only the party
// and the last column differ. Values are the list helpers' (stored paid / due
// / payment status) — nothing is recomputed.
function documentColumns(partyLabel: string, last: "paymentStatus" | "paymentType"): ReportColumn<PurchaseDocumentRow>[] {
  const cells: ReportColumn<PurchaseDocumentRow>[] = [
    { label: "Reference", width: "", render: (row) => <ReferenceCell value={row.reference} /> },
    { label: partyLabel, width: "", render: (row) => <TextCell value={row.party.name} /> },
    { label: "Warehouse", width: "", render: (row) => <TextCell value={row.warehouse.name} muted /> },
    { label: "Status", width: "", render: (row) => <PurchaseStatusPill status={row.status} /> },
    { label: "Grand total", width: "", align: "right", render: (row) => <MoneyCell value={formatNaira(row.grandTotal)} strong /> },
    { label: "Paid", width: "", align: "right", render: (row) => <MoneyCell value={formatNaira(row.paid ?? "0")} /> },
    { label: "Due", width: "", align: "right", render: (row) => <MoneyCell value={formatNaira(row.due ?? "0")} /> },
    last === "paymentStatus"
      ? {
          label: "Payment status",
          width: "",
          render: (row) => (row.paymentStatus ? <PaymentStatusPill paymentStatus={row.paymentStatus} /> : null),
        }
      : {
          label: "Payment type",
          width: "",
          render: (row) =>
            row.paymentType ? (
              <PaymentTypePill paymentType={row.paymentType} />
            ) : (
              <span style={{ color: COLORS.slateLight }}>—</span>
            ),
        },
  ];
  return cells.map((cell, i) => ({ ...cell, width: DOC_WIDTHS[i] }));
}

const EXPENSE_COLUMNS: ReportColumn<ExpenseRow>[] = [
  { label: "Reference", width: "130px", render: (row) => <ReferenceCell value={row.reference} /> },
  { label: "Expense title", width: "minmax(180px,1fr)", render: (row) => <TextCell value={row.title} /> },
  { label: "Warehouse", width: "140px", render: (row) => <TextCell value={row.warehouseName} muted /> },
  { label: "Expense category", width: "minmax(160px,1fr)", render: (row) => <TextCell value={row.categoryName} /> },
  { label: "Amount", width: "160px", align: "right", render: (row) => <MoneyCell value={formatNaira(row.amount)} strong /> },
  {
    label: "Created on",
    width: "150px",
    render: (row) => (
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{row.createdDate}</span>
        <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{row.createdTime}</span>
      </span>
    ),
  },
];

// /reports/warehouse — the landing report. Warehouse filter → 4 document
// counts → a sub-tab table (each one its list page's helper), with search,
// date range (Filters), pagination and Excel, all from the URL.
export default async function WarehouseReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  const params = await searchParams;
  const { warehouses, selected } = await getReportWarehouses(params.warehouse);
  // An unknown/deleted warehouse id falls back to All Warehouse.
  const filters = { ...parseReportParams(params), warehouseId: selected?.id };
  const tab = parseWarehouseReportTab(params.tab);

  const [counts, table] = await Promise.all([
    getWarehouseReportCounts(selected?.id),
    getWarehouseReportTable(tab, filters),
  ]);
  const totalPages = Math.max(1, Math.ceil(table.total / filters.perPage));
  const where = selected ? ` in ${selected.name}` : "";

  return (
    <>
      <Suspense fallback={null}>
        <ReportWarehouseSelect warehouses={warehouses} value={selected?.id ?? ""} />
      </Suspense>

      <ReportCountTiles counts={counts} />

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          overflow: "hidden",
        }}
      >
        <Suspense fallback={null}>
          <ReportSubTabs tabs={WAREHOUSE_REPORT_TABS} active={tab} />
        </Suspense>
        <div style={{ padding: "18px 20px", position: "relative", zIndex: 2 }}>
          <ReportToolbar excelHref={reportExportHref("warehouse", filters, { tab })} />
        </div>

        {table.kind === "expenses" ? (
          <ReportTable
            columns={EXPENSE_COLUMNS}
            rows={table.rows}
            rowKey={(row) => row.id}
            minWidth={1040}
            emptyMessage={`No expenses found${where}.`}
          />
        ) : (
          <ReportTable
            columns={
              table.kind === "sales"
                ? documentColumns("Customer", "paymentStatus")
                : table.kind === "sale-returns"
                  ? documentColumns("Customer", "paymentStatus")
                  : documentColumns("Supplier", "paymentType")
            }
            rows={table.rows}
            rowKey={(row) => row.id}
            minWidth={1120}
            emptyMessage={
              table.kind === "sales"
                ? `No sales found${where}.`
                : table.kind === "sale-returns"
                  ? `No sales returns found${where}.`
                  : `No purchases returns found${where}.`
            }
          />
        )}

        <Suspense fallback={null}>
          <Pagination
            page={filters.page}
            perPage={filters.perPage}
            total={table.total}
            totalPages={totalPages}
            perPageOptions={REPORT_PER_PAGE_OPTIONS}
            showPageNumbers
          />
        </Suspense>
      </div>
    </>
  );
}
