// Report filters live in the URL, so every view is linkable and the Excel
// export can re-run exactly what's on screen:
//
//   ?warehouse=<id>   a warehouse id, or absent for "All Warehouse"
//   &from=YYYY-MM-DD  inclusive start day   } on the app calendar
//   &to=YYYY-MM-DD    inclusive end day     } (lib/dateRanges.ts)
//   &q=…              search
//   &tab=…            sub-tab (Warehouse Reports)
//   &page=, &perPage= pagination
//
// Dates: documents store their day at UTC midnight, so an inclusive
// from/to becomes [from 00:00, to+1 00:00) — the whole of the `to` day —
// via dateRangeWhere (purchases/queries.ts), the list pages' own filter.

// Records per page, as the design (10 / 25).
export const REPORT_PER_PAGE_OPTIONS = [10, 25];
const DEFAULT_PER_PAGE = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ReportSearchParams = {
  warehouse?: string;
  from?: string;
  to?: string;
  q?: string;
  tab?: string;
  page?: string;
  perPage?: string;
};

export type ReportFilters = {
  warehouseId?: string;
  from?: string;
  to?: string;
  q: string;
  page: number;
  perPage: number;
};

const validDay = (value: string | undefined) =>
  value && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : undefined;

// Normalises the URL; an unknown warehouse id is dropped (→ All Warehouse)
// once the caller checks it against the active warehouses. A reversed range
// is swapped rather than returning nothing.
export function parseReportParams(params: ReportSearchParams): ReportFilters {
  let from = validDay(params.from);
  let to = validDay(params.to);
  if (from && to && from > to) [from, to] = [to, from];
  const perPage = Number(params.perPage);
  return {
    warehouseId: params.warehouse?.trim() || undefined,
    from,
    to,
    q: params.q?.trim() ?? "",
    page: Math.max(1, Number(params.page) || 1),
    perPage: REPORT_PER_PAGE_OPTIONS.includes(perPage) ? perPage : DEFAULT_PER_PAGE,
  };
}

// ------------------------------------------------------------ Excel export

export const EXPORT_REPORTS = ["warehouse", "sale", "purchase", "stock"] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

export const isExportReport = (value: string): value is ExportReport =>
  (EXPORT_REPORTS as readonly string[]).includes(value);

// The EXCEL button's link: the CURRENT filters (already normalised — e.g. an
// unknown warehouse is gone), without pagination; the export re-runs them.
export function reportExportHref(report: ExportReport, filters: ReportFilters, extra: { tab?: string } = {}): string {
  const params = new URLSearchParams();
  if (filters.warehouseId) params.set("warehouse", filters.warehouseId);
  if (extra.tab) params.set("tab", extra.tab);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return `/reports/export/${report}${query ? `?${query}` : ""}`;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// "sale-reports_main-office_2026-10-01_to_2026-10-31.xlsx". The date part is
// the range ("all-dates" without one); `asOf` replaces it for a balance
// (Stock Reports: "as-of_2026-10-28").
export function reportFilename(
  name: string,
  { warehouse, from, to, asOf }: { warehouse?: string; from?: string; to?: string; asOf?: string },
): string {
  const range = asOf
    ? `as-of_${asOf}`
    : from && to
      ? `${from}_to_${to}`
      : from
        ? `from_${from}`
        : to
          ? `until_${to}`
          : "all-dates";
  return [slug(name), warehouse ? slug(warehouse) || "warehouse" : "all-warehouses", range].join("_") + ".xlsx";
}
