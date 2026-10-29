// Run with: npx tsx --test lib/reports/params.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseReportParams, reportExportHref, reportFilename } from "./params";

describe("parseReportParams", () => {
  test("defaults: all warehouses, no dates, page 1, 10 per page", () => {
    assert.deepEqual(parseReportParams({}), { warehouseId: undefined, from: undefined, to: undefined, q: "", page: 1, perPage: 10 });
  });

  test("keeps valid values; trims search and warehouse", () => {
    assert.deepEqual(
      parseReportParams({ warehouse: " w1 ", from: "2026-10-01", to: "2026-10-27", q: "  SA_1 ", page: "3", perPage: "25" }),
      { warehouseId: "w1", from: "2026-10-01", to: "2026-10-27", q: "SA_1", page: 3, perPage: 25 },
    );
  });

  test("drops invalid dates; swaps a reversed range", () => {
    assert.deepEqual(parseReportParams({ from: "2026-13-01", to: "yesterday" }).from, undefined);
    const r = parseReportParams({ from: "2026-10-27", to: "2026-10-01" });
    assert.deepEqual([r.from, r.to], ["2026-10-01", "2026-10-27"]);
  });

  test("page ≥ 1; per page only 10 or 25", () => {
    assert.equal(parseReportParams({ page: "-4" }).page, 1);
    assert.equal(parseReportParams({ page: "abc" }).page, 1);
    assert.equal(parseReportParams({ perPage: "50" }).perPage, 10);
  });
});

describe("reportExportHref", () => {
  const base = parseReportParams({});
  test("no filters → bare export URL", () => {
    assert.equal(reportExportHref("sale", base), "/reports/export/sale");
  });
  test("current filters, no pagination", () => {
    const filters = parseReportParams({ warehouse: "w1", from: "2026-10-01", to: "2026-10-31", q: "SA 1", page: "3", perPage: "25" });
    assert.equal(
      reportExportHref("warehouse", filters, { tab: "expenses" }),
      "/reports/export/warehouse?warehouse=w1&tab=expenses&from=2026-10-01&to=2026-10-31&q=SA+1",
    );
  });
});

describe("reportFilename", () => {
  test("report name, warehouse and date range", () => {
    assert.equal(
      reportFilename("sale-reports", { warehouse: "Main Office", from: "2026-10-01", to: "2026-10-31" }),
      "sale-reports_main-office_2026-10-01_to_2026-10-31.xlsx",
    );
  });
  test("no range / open ranges / as-of", () => {
    assert.equal(reportFilename("purchase-reports", {}), "purchase-reports_all-warehouses_all-dates.xlsx");
    assert.equal(reportFilename("sale-reports", { from: "2026-10-01" }), "sale-reports_all-warehouses_from_2026-10-01.xlsx");
    assert.equal(reportFilename("sale-reports", { to: "2026-10-31" }), "sale-reports_all-warehouses_until_2026-10-31.xlsx");
    assert.equal(
      reportFilename("stock-reports", { warehouse: "Andi Bitrus", asOf: "2026-10-28" }),
      "stock-reports_andi-bitrus_as-of_2026-10-28.xlsx",
    );
  });
});
