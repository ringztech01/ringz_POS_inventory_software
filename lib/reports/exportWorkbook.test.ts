// The multi-sheet workbook (Restaurant Reports' export, Step 10): header
// rows, typed cells (money, integers, quantities, percentages, real dates on
// the business's clock), the total row, several sheets — written whole or
// streamed, the same either way.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildWorkbook, excelDate, fraction, tableHeaderRow, workbookStream, type WorkbookSheet } from "./exportXlsx";
import { cells, unzip } from "./xlsxRead.test-util";

const NOW = new Date("2026-11-13T09:30:00.000Z");

function sample(): WorkbookSheet[] {
  return [
    {
      name: "By dish",
      info: [
        { label: "Business", value: "Mama Put" },
        { label: "Generated at", value: NOW, kind: "datetime" },
      ],
      columns: [
        { header: "Dish", width: 20 },
        { header: "Qty", kind: "integer" },
        { header: "Net sales", kind: "money" },
        { header: "Share", kind: "percent" },
        { header: "Kg", kind: "decimal" },
        { header: "Day", kind: "date" },
      ],
      rows: [
        ["Jollof & rice", 4, "81.00", 62.8, "2.5", new Date("2026-11-12T00:00:00.000Z")],
        ["<Zobo>", 2, "-18.50", null, null, null],
      ],
      totals: ["Total", 6, "62.50", 100, null, null],
    },
    // Same safe name twice: kept apart.
    { name: "By dish", columns: [{ header: "Figure" }, { header: "Value" }], rows: [["Net sales", { value: "12.50", kind: "money" }], ["Orders", { value: 3, kind: "integer" }]] },
  ];
}

describe("workbooks", () => {
  test("header rows, then the table: typed cells, the total row bold", async () => {
    const files = unzip(await buildWorkbook(sample(), { utcOffsetMinutes: 60, now: NOW }));
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    const byRef = new Map(cells(sheet).map((c) => [c.ref, c]));
    assert.equal(tableHeaderRow({ info: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }), 4);
    assert.deepEqual([byRef.get("A1")?.value, byRef.get("B1")?.value, byRef.get("A2")?.value], ["Business", "Mama Put", "Generated at"]);
    assert.equal(Number(byRef.get("B2")?.value), excelDate(NOW, 60), "a real date, on Lagos time");
    assert.equal(byRef.get("A4")?.value, "Dish", "headings below the header rows");
    assert.match(sheet, /<pane ySplit="4" topLeftCell="A5"/, "frozen under the headings");
    assert.deepEqual([byRef.get("B5")?.value, byRef.get("C5")?.value, byRef.get("D5")?.value, byRef.get("E5")?.value], ["4", "81.00", "0.628", "2.5"]);
    assert.deepEqual([byRef.get("B5")?.style, byRef.get("C5")?.style, byRef.get("D5")?.style, byRef.get("E5")?.style, byRef.get("F5")?.style], ["3", "2", "5", "4", "6"]);
    // 12 Nov 2026 is day 46338 (1 Jan 2026 is 46023); +1 hour for Lagos.
    assert.ok(Math.abs(Number(byRef.get("F5")?.value) - (46338 + 1 / 24)) < 1e-9, "12 Nov 2026, on Lagos time");
    assert.equal(byRef.get("A5")?.value, "Jollof &amp; rice", "text escaped");
    assert.equal(byRef.get("C6")?.value, "-18.50", "negative money a number");
    assert.ok(!byRef.has("D6"), "an empty cell is left out");
    assert.deepEqual([byRef.get("A7")?.style, byRef.get("C7")?.style, byRef.get("D7")?.value], ["1", "8", "1"], "the total row: bold text, bold money, 100%");
  });

  test("percentages are stored exactly (14.3% → 0.143)", () => {
    assert.deepEqual(["14.3", "62.8", "100", "0", "-5.5", "33.3"].map(fraction), ["0.143", "0.628", "1", "0", "-0.055", "0.333"]);
  });

  test("several sheets, each named once; a cell with its own kind", async () => {
    const files = unzip(await buildWorkbook(sample(), { utcOffsetMinutes: 60, now: NOW }));
    assert.match(files.get("xl/workbook.xml")!, /<sheet name="By dish" sheetId="1" r:id="rId1"\/><sheet name="By dish 2" sheetId="2" r:id="rId2"\/>/);
    assert.match(files.get("[Content_Types].xml")!, /sheet2\.xml/);
    const second = new Map(cells(files.get("xl/worksheets/sheet2.xml")!).map((c) => [c.ref, c]));
    assert.deepEqual([second.get("B2")?.value, second.get("B2")?.style, second.get("B3")?.style], ["12.50", "2", "3"]);
  });

  test("streamed (rows from an async source): the same files", async () => {
    const whole = unzip(await buildWorkbook(sample(), { utcOffsetMinutes: 60, now: NOW }));
    const streamedSheets = sample().map((s) => ({
      ...s,
      rows: (async function* () {
        for (const r of s.rows as unknown[][]) yield r as never;
      })(),
    }));
    const chunks: Uint8Array[] = [];
    const reader = workbookStream(streamedSheets, { utcOffsetMinutes: 60, now: NOW }).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const streamed = unzip(Buffer.concat(chunks));
    assert.deepEqual([...streamed.keys()].sort(), [...whole.keys()].sort());
    for (const [name, xml] of whole) assert.equal(streamed.get(name), xml, name);
  });

  test("a big sheet streams in pieces (many rows)", async () => {
    const rows = (async function* () {
      for (let i = 0; i < 60_000; i++) yield [`Line ${i}`, i, "1.00"];
    })();
    let bytes = 0;
    let pieces = 0;
    const reader = workbookStream([{ name: "Big", columns: [{ header: "Line" }, { header: "N", kind: "integer" }, { header: "Amount", kind: "money" }], rows }], { now: NOW }).getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      pieces += 1;
      parts.push(value);
    }
    assert.ok(pieces > 20, `${pieces} pieces`);
    const sheet = unzip(Buffer.concat(parts)).get("xl/worksheets/sheet1.xml")!;
    assert.ok(sheet.includes(`<row r="60001">`) && sheet.endsWith("</sheetData></worksheet>"));
    assert.ok(bytes < 3_000_000, "compressed");
  });
});
