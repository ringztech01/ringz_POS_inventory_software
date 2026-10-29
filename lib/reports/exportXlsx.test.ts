// Run with: npx tsx --test lib/reports/exportXlsx.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildXlsx, columnLetter, xlsxResponse } from "./exportXlsx";

// Minimal zip reader: the central directory → { name: text }, checking each
// entry's CRC-32 against the inflated bytes.
function unzip(file: Buffer): Record<string, string> {
  const end = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(file.readUInt32LE(at), 0x02014b50);
    const crc = file.readUInt32LE(at + 16);
    const size = file.readUInt32LE(at + 20);
    const nameLength = file.readUInt16LE(at + 28);
    const local = file.readUInt32LE(at + 42);
    const name = file.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const localNameLength = file.readUInt16LE(local + 26);
    const data = inflateRawSync(file.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size));
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out[name] = data.toString("utf8");
    at += 46 + nameLength;
  }
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

type Row = { ref: string; party: string; total: string; stock: number; note: string | null };
const ROWS: Row[] = [
  { ref: "SA_1", party: "Ade & Sons <Ltd>", total: "560000.00", stock: 1200, note: null },
  { ref: "SA_2", party: "direct-customer", total: "-12.50", stock: 0, note: "x" },
];
const sheet = buildXlsx({
  sheetName: "Sale Reports: [Oct]",
  columns: [
    { header: "Reference", value: (row: Row) => row.ref },
    { header: "Customer", width: 30, value: (row: Row) => row.party },
    { header: "Grand total", kind: "money", value: (row: Row) => row.total },
    { header: "Stock", kind: "integer", value: (row: Row) => row.stock },
    { header: "Note", value: (row: Row) => row.note },
  ],
  rows: ROWS,
});

describe("buildXlsx", () => {
  const files = unzip(sheet);
  const xml = files["xl/worksheets/sheet1.xml"];

  test("has the parts Excel needs (CRCs checked while unzipping)", () => {
    assert.deepEqual(Object.keys(files).sort(), [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  test("bold header row, frozen", () => {
    assert.match(xml, /<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Reference<\/t><\/is><\/c>/);
    assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  });

  test("money and integers stay numeric, written exactly", () => {
    assert.match(xml, /<c r="C2" s="2"><v>560000.00<\/v><\/c>/);
    assert.match(xml, /<c r="C3" s="2"><v>-12.50<\/v><\/c>/);
    assert.match(xml, /<c r="D2" s="3"><v>1200<\/v><\/c>/);
    assert.match(xml, /<c r="D3" s="3"><v>0<\/v><\/c>/);
    assert.match(files["xl/styles.xml"], /formatCode="&quot;₦&quot;#,##0.00"/);
  });

  test("text is escaped; null is an empty cell", () => {
    assert.match(xml, /<t xml:space="preserve">Ade &amp; Sons &lt;Ltd&gt;<\/t>/);
    assert.doesNotMatch(xml, /r="E2"/);
    assert.match(xml, /r="E3"/);
  });

  test("column widths and a safe sheet name", () => {
    assert.match(xml, /<col min="2" max="2" width="30" customWidth="1"\/>/);
    // "Sale Reports: [Oct]" — the forbidden :[] become spaces, then trimmed.
    assert.match(files["xl/workbook.xml"], /<sheet name="Sale Reports   Oct" sheetId="1"/);
  });
});

test("columnLetter", () => {
  assert.deepEqual([0, 7, 25, 26, 27, 701, 702].map(columnLetter), ["A", "H", "Z", "AA", "AB", "ZZ", "AAA"]);
});

test("xlsxResponse: attachment, xlsx type, no-store", () => {
  const res = xlsxResponse("sale-reports_all-warehouses_all-dates.xlsx", sheet);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(res.headers.get("content-disposition")!, /^attachment; filename="sale-reports_all-warehouses_all-dates\.xlsx"/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("content-length"), String(sheet.length));
});
