import "server-only";
import { formatDateTime } from "@/lib/format";
import { todayInAppZone } from "@/lib/dateRanges";
import {
  DOCUMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
} from "@/components/purchases/purchase-display";
import type { PurchaseDocumentRow } from "@/components/purchases/PurchaseTable";
import type { ExpenseRow } from "@/components/expenses/ExpenseTable";
import type { PurchaseListRow } from "@/app/(dashboard)/purchases/queries";
import { buildXlsx, type XlsxColumn } from "./exportXlsx";
import { parseReportParams, reportFilename, type ExportReport, type ReportSearchParams } from "./params";
import {
  getPurchaseReport,
  getReportWarehouses,
  getSaleReport,
  getStockReport,
  getWarehouseReportTable,
  parseWarehouseReportTab,
  WAREHOUSE_REPORT_TABS,
  type StockReportRow,
} from "./queries";

// Excel exports: each report's OWN query (the one its page renders) re-run for
// the URL's filters with every row on one page, and the page's columns. So the
// file is exactly the on-screen set, unpaginated.

// More rows than this → ask for a narrower filter instead of building a huge
// file in memory.
export const EXPORT_ROW_LIMIT = 50_000;

type Export = { filename: string; file: Buffer } | { error: string };

const createdOn = (date: Date) => {
  const { date: day, time } = formatDateTime(date);
  return `${day} ${time}`;
};

// Sales / Sales Returns / Purchases Returns (Warehouse Reports sub-tabs).
function documentColumns(party: string, last: "paymentStatus" | "paymentType"): XlsxColumn<PurchaseDocumentRow>[] {
  return [
    { header: "Reference", width: 20, value: (row) => row.reference },
    { header: party, width: 26, value: (row) => row.party.name },
    { header: "Warehouse", width: 20, value: (row) => row.warehouse.name },
    { header: "Status", width: 12, value: (row) => DOCUMENT_STATUS_LABELS[row.status] },
    { header: "Grand total", width: 16, kind: "money", value: (row) => row.grandTotal },
    { header: "Paid", width: 16, kind: "money", value: (row) => row.paid ?? "0" },
    { header: "Due", width: 16, kind: "money", value: (row) => row.due ?? "0" },
    last === "paymentStatus"
      ? { header: "Payment status", width: 15, value: (row) => (row.paymentStatus ? PAYMENT_STATUS_LABELS[row.paymentStatus] : "") }
      : { header: "Payment type", width: 15, value: (row) => (row.paymentType ? PAYMENT_TYPE_LABELS[row.paymentType] : "") },
  ];
}

const EXPENSE_COLUMNS: XlsxColumn<ExpenseRow>[] = [
  { header: "Reference", width: 20, value: (row) => row.reference },
  { header: "Expense title", width: 30, value: (row) => row.title },
  { header: "Warehouse", width: 20, value: (row) => row.warehouseName },
  { header: "Expense category", width: 22, value: (row) => row.categoryName },
  { header: "Amount", width: 16, kind: "money", value: (row) => row.amount },
  { header: "Created on", width: 20, value: (row) => `${row.createdDate} ${row.createdTime}` },
];

const SALE_COLUMNS: XlsxColumn<PurchaseDocumentRow>[] = [
  { header: "Reference", width: 20, value: (row) => row.reference },
  { header: "Customer", width: 26, value: (row) => row.party.name },
  { header: "Status", width: 12, value: (row) => DOCUMENT_STATUS_LABELS[row.status] },
  { header: "Grand total", width: 16, kind: "money", value: (row) => row.grandTotal },
  { header: "Paid", width: 16, kind: "money", value: (row) => row.paid ?? "0" },
  { header: "Payment status", width: 15, value: (row) => (row.paymentStatus ? PAYMENT_STATUS_LABELS[row.paymentStatus] : "") },
];

// Paid / Due are left empty: purchases don't record payments (the page shows —).
const PURCHASE_COLUMNS: XlsxColumn<PurchaseListRow>[] = [
  { header: "Reference", width: 20, value: (row) => row.reference },
  { header: "Supplier", width: 26, value: (row) => row.party.name },
  { header: "Status", width: 12, value: (row) => DOCUMENT_STATUS_LABELS[row.status] },
  { header: "Grand total", width: 16, kind: "money", value: (row) => row.grandTotal },
  { header: "Paid", width: 14, kind: "money", value: () => null },
  { header: "Due", width: 14, kind: "money", value: () => null },
  { header: "Payment type", width: 15, value: (row) => PAYMENT_TYPE_LABELS[row.paymentType] },
  { header: "Created on", width: 20, value: (row) => createdOn(row.createdAt) },
];

// Stock stays a number; the unit (a chip beside it on screen) is its own column.
const STOCK_COLUMNS: XlsxColumn<StockReportRow>[] = [
  { header: "Code", width: 18, value: (row) => row.code },
  { header: "Name", width: 32, value: (row) => row.name },
  { header: "Category", width: 18, value: (row) => row.categoryName },
  { header: "Cost", width: 15, kind: "money", value: (row) => row.cost },
  { header: "Price", width: 15, kind: "money", value: (row) => row.price },
  { header: "Current stock", width: 14, kind: "integer", value: (row) => row.stock },
  { header: "Unit", width: 12, value: (row) => row.unitName },
];

const tooMany = (total: number) => ({
  error: `This report has ${total.toLocaleString("en-NG")} rows — more than the ${EXPORT_ROW_LIMIT.toLocaleString("en-NG")} an export can hold. Narrow the filters and try again.`,
});

const sheetOf = <T,>(sheetName: string, columns: XlsxColumn<T>[], rows: T[]) => buildXlsx({ sheetName, columns, rows });

export async function buildReportExport(report: ExportReport, params: ReportSearchParams): Promise<Export> {
  const { selected } = await getReportWarehouses(params.warehouse);
  // Same normalisation as the page; every row on one page.
  const filters = { ...parseReportParams(params), warehouseId: selected?.id, page: 1, perPage: EXPORT_ROW_LIMIT + 1 };
  const naming = { warehouse: selected?.name, from: filters.from, to: filters.to };

  switch (report) {
    case "warehouse": {
      const tab = parseWarehouseReportTab(params.tab);
      const label = WAREHOUSE_REPORT_TABS.find((t) => t.key === tab)!.label;
      const table = await getWarehouseReportTable(tab, filters);
      if (table.total > EXPORT_ROW_LIMIT) return tooMany(table.total);
      const filename = reportFilename(`warehouse-reports-${tab}`, naming);
      switch (table.kind) {
        case "sales":
          return { filename, file: sheetOf(label, documentColumns("Customer", "paymentStatus"), table.rows) };
        case "sale-returns":
          return { filename, file: sheetOf(label, documentColumns("Customer", "paymentStatus"), table.rows) };
        case "purchase-returns":
          return { filename, file: sheetOf(label, documentColumns("Supplier", "paymentType"), table.rows) };
        case "expenses":
          return { filename, file: sheetOf(label, EXPENSE_COLUMNS, table.rows) };
      }
    }
    case "sale": {
      const { rows, total } = await getSaleReport(filters);
      if (total > EXPORT_ROW_LIMIT) return tooMany(total);
      return { filename: reportFilename("sale-reports", naming), file: sheetOf("Sale Reports", SALE_COLUMNS, rows) };
    }
    case "purchase": {
      const { rows, total } = await getPurchaseReport(filters);
      if (total > EXPORT_ROW_LIMIT) return tooMany(total);
      return {
        filename: reportFilename("purchase-reports", naming),
        file: sheetOf("Purchase Reports", PURCHASE_COLUMNS, rows),
      };
    }
    case "stock": {
      const { rows, total } = await getStockReport(filters);
      if (total > EXPORT_ROW_LIMIT) return tooMany(total);
      // Stock is a balance now, not a date range.
      return {
        filename: reportFilename("stock-reports", { warehouse: selected?.name, asOf: todayInAppZone() }),
        file: sheetOf("Stock Reports", STOCK_COLUMNS, rows),
      };
    }
  }
}
