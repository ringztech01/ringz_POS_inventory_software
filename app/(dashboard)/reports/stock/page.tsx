import { Suspense } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { formatNaira } from "@/lib/format";
import { parseReportParams, REPORT_PER_PAGE_OPTIONS, reportExportHref, type ReportSearchParams } from "@/lib/reports/params";
import { getReportWarehouses, getStockReport, type StockReportRow } from "@/lib/reports/queries";
import { COLORS, FONTS } from "@/components/layout/theme";
import Pagination from "@/components/ui/Pagination";
import ReportWarehouseSelect from "@/components/reports/ReportWarehouseSelect";
import ReportToolbar from "@/components/reports/ReportToolbar";
import ReportLinkButton from "@/components/reports/ReportLinkButton";
import ReportTable, { MoneyCell, ReferenceCell, TextCell, type ReportColumn } from "@/components/reports/ReportTable";

const chip = { fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6 } as const;

// Design grid (RingzPOS Reports.dc.html → STOCK REPORTS). The warehouse is
// carried into the product's report link.
function stockColumns(warehouseId?: string): ReportColumn<StockReportRow>[] {
  const query = warehouseId ? `?warehouse=${encodeURIComponent(warehouseId)}` : "";
  return [
    { label: "Code", width: "130px", render: (row) => <ReferenceCell value={row.code} /> },
    { label: "Name", width: "minmax(200px,1.3fr)", render: (row) => <TextCell value={row.name} /> },
    { label: "Category", width: "150px", render: (row) => <TextCell value={row.categoryName} muted /> },
    {
      label: "Cost",
      width: "150px",
      align: "right",
      render: (row) =>
        row.cost === null ? (
          <span style={{ fontSize: 13, color: COLORS.slateLight }}>—</span>
        ) : (
          <MoneyCell value={formatNaira(row.cost)} />
        ),
    },
    { label: "Price", width: "150px", align: "right", render: (row) => <MoneyCell value={formatNaira(row.price)} strong /> },
    {
      label: "Current stock",
      width: "170px",
      render: (row) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...chip, fontFamily: FONTS.mono, background: "#e6f1fb", color: "#1a5c93" }}>
            {row.stock.toLocaleString("en-NG")}
          </span>
          <span style={{ ...chip, background: "#e2f4ec", color: "#0b6146" }}>{row.unitName}</span>
        </span>
      ),
    },
    {
      label: "Action",
      width: "130px",
      align: "right",
      render: (row) => <ReportLinkButton href={`/reports/stock/${row.id}${query}`} label="Reports" />,
    },
  ];
}

// /reports/stock — every live product (the Products list's search and order)
// with its current stock in the selected warehouse, or summed over all
// warehouses. Search, pagination and Excel; no date range — stock is
// a current balance.
export default async function StockReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  const params = await searchParams;
  const { warehouses, selected } = await getReportWarehouses(params.warehouse);
  // An unknown/deleted warehouse id falls back to All Warehouse.
  const filters = { ...parseReportParams(params), warehouseId: selected?.id };
  const { rows, total } = await getStockReport(filters);
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  return (
    <>
      <Suspense fallback={null}>
        <ReportWarehouseSelect warehouses={warehouses} value={selected?.id ?? ""} />
      </Suspense>

      <ReportToolbar searchWidth={360} searchHeight={40} filters={false} excelHref={reportExportHref("stock", filters)} />

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
          columns={stockColumns(selected?.id)}
          rows={rows}
          rowKey={(row) => row.id}
          minWidth={1080}
          rowHeight={60}
          flush
          emptyMessage="No products found."
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
