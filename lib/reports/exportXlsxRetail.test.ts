// Run with: npx tsx --test lib/reports/exportXlsxRetail.test.ts
// Restaurant Reports Step 12, regression: the retail exports' helper writes
// exactly the bytes it did before the Reports work (commit aadffd5). The
// hashes below were taken from that version's buildXlsx with the same sheets
// at the same frozen moment. The zip stores the local time, so the zone is
// fixed (Lagos, the app's). Also: the retail screens don't use the options
// the shared components gained for Restaurant Reports.
process.env.TZ = "Africa/Lagos";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildXlsx, columnLetter, xlsxResponse, type XlsxSheet } from "./exportXlsx";

// The retail exports' shapes: text, money (Decimal strings, negatives, not a
// number), integers, empty cells, XML escaping and characters XML can't
// carry, a long sheet name with characters Excel forbids, more than 26
// columns, widths, a few thousand rows.
type Row = { ref: string; party: string | null; total: string; paid: string; qty: number | null; note: string };
const rows: Row[] = Array.from({ length: 3000 }, (_, i) => ({
  ref: `SA_${String(i).padStart(4, "0")}`,
  party: i % 7 === 0 ? null : `Walk-in & <Co> "${i}" ₦`,
  total: i % 11 === 0 ? "-12.50" : (i * 137.25).toFixed(2),
  paid: i % 13 === 0 ? "n/a" : (i * 100).toFixed(2),
  qty: i % 5 === 0 ? null : i,
  note: i % 17 === 0 ? `tab\there\u0001bell\u000bvt` : "",
}));
const SHEETS: XlsxSheet<Row>[] = [
  { sheetName: "Sales", rows, columns: [
    { header: "Reference", width: 16, value: (r) => r.ref },
    { header: "Customer", width: 28, value: (r) => r.party },
    { header: "Grand total", kind: "money", value: (r) => r.total },
    { header: "Paid", kind: "money", width: 14, value: (r) => r.paid },
    { header: "Qty", kind: "integer", value: (r) => r.qty },
    { header: "Note", value: (r) => r.note },
  ] },
  { sheetName: "Stock: [Main]/Office*?a very long name over thirty-one", rows: rows.slice(0, 40), columns: Array.from({ length: 30 }, (_, c) => ({ header: `Col ${c}`, kind: c % 3 === 0 ? ("money" as const) : c % 3 === 1 ? ("integer" as const) : ("text" as const), value: (r: Row) => (c % 3 === 0 ? r.total : c % 3 === 1 ? r.qty : r.party) })) },
  { sheetName: "Empty", rows: [], columns: [{ header: "Nothing", value: () => null }] },
];

const BEFORE: Record<string, [number, string]> = {
  Sales: [102497, "4c61aed6eaf63ed033ffbb62a1b036656a8169f8c497eadbdd18c4f85377226e"],
  "Stock: [Main]/Office*?a very long name over thirty-one": [6241, "db0ce3cfcac4ffdd64b48907abdcc1da52e1176b1f2291d3d6ff9b5e2cf1f225"],
  Empty: [2223, "9098cdf694eae4f244222c42ed4e7b35ebead20d151a82b3321897f4f70f927a"],
};

test("buildXlsx: byte-identical to before the Reports work", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-13T09:41:27.000Z") });
  try {
    for (const sheet of SHEETS) {
      const bytes = buildXlsx(sheet);
      assert.deepEqual([bytes.length, createHash("sha256").update(bytes).digest("hex")], BEFORE[sheet.sheetName], sheet.sheetName);
    }
  } finally {
    mock.timers.reset();
  }
});

test("xlsxResponse and columnLetter: as before", () => {
  const response = xlsxResponse("Stock – Main/Office ₦.xlsx", Buffer.from("x"));
  assert.deepEqual(Object.fromEntries(response.headers), {
    "cache-control": "private, no-store",
    "content-disposition": "attachment; filename=\"Stock___Main_Office__.xlsx\"; filename*=UTF-8''Stock%20%E2%80%93%20Main%2FOffice%20%E2%82%A6.xlsx",
    "content-length": "1",
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.deepEqual([0, 25, 26, 701, 702].map(columnLetter), ["A", "Z", "AA", "ZZ", "AAA"]);
});

test("the retail screens don't use the Restaurant Reports options of DonutCard and ReportDatePicker", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  const dashboard = read("app/(dashboard)/dashboard/page.tsx");
  assert.equal(dashboard.match(/<DonutCard\b/g)?.length, 2, "the Dashboard's two doughnuts");
  assert.doesNotMatch(dashboard, /\b(legend|cutout)=/);
  // Each slice is { label, value, detail }: no colour of its own, so the palette as before.
  const slices = dashboard.match(/slices=\{[\s\S]*?\}\)\)\}/g) ?? [];
  assert.equal(slices.length, 2);
  for (const use of slices) assert.doesNotMatch(use, /\bcolor\b/, use);
  const picker = read("components/reports/ReportToolbar.tsx").match(/<ReportDatePicker[\s\S]*?\/>/g) ?? [];
  assert.ok(picker.length > 0);
  for (const use of picker) assert.doesNotMatch(use, /\b(presets|current)=/);
});
