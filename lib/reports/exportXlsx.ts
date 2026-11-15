import { constants as zlibConstants, createDeflateRaw, deflateRawSync } from "node:zlib";

// One-sheet .xlsx writer for the report exports — no dependency: an .xlsx is
// a zip of a few XML parts, written here with node:zlib.
//
// A report export is its columns + its rows (the report's own query, without
// pagination). Money cells stay NUMBERS: the Decimal string goes into the
// cell as written (no float round-trip) with a ₦ number format, so Excel can
// sum it. Integer cells (stock) likewise.

export type XlsxCellKind = "text" | "money" | "integer";

export type XlsxColumn<T> = {
  header: string;
  // Column width in Excel characters.
  width?: number;
  kind?: XlsxCellKind;
  // null/undefined/"" → an empty cell.
  value: (row: T) => string | number | null | undefined;
};

export type XlsxSheet<T> = {
  sheetName: string;
  columns: XlsxColumn<T>[];
  rows: T[];
};

// Style indexes into cellXfs (styles.xml below).
const STYLE = { text: 0, header: 1, money: 2, integer: 3 } as const;
const NUMBER = /^-?\d+(\.\d+)?$/;

const escapeXml = (value: string) =>
  value
    // Characters XML 1.0 can't carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 0 → A, 25 → Z, 26 → AA.
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function cellXml(ref: string, value: string | number | null | undefined, kind: XlsxCellKind): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if ((kind === "money" || kind === "integer") && NUMBER.test(text)) {
    return `<c r="${ref}" s="${STYLE[kind]}"><v>${text}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function sheetXml<T>({ columns, rows }: XlsxSheet<T>): string {
  const header = columns
    .map(
      (column, i) =>
        `<c r="${columnLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${escapeXml(column.header)}</t></is></c>`,
    )
    .join("");
  const body = rows
    .map((row, r) => {
      const cells = columns.map((column, i) => cellXml(`${columnLetter(i)}${r + 2}`, column.value(row), column.kind ?? "text"));
      return `<row r="${r + 2}">${cells.join("")}</row>`;
    })
    .join("");
  const cols = columns
    .map((column, i) => `<col min="${i + 1}" max="${i + 1}" width="${column.width ?? 16}" customWidth="1"/>`)
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    // Header row frozen.
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₦&quot;#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

// Excel sheet names: ≤ 31 characters, none of []:*?/\
const safeSheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Report";

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// A deflate zip of the given files (UTF-8 names).
function zip(files: { name: string; data: string }[], now = new Date()): Buffer {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const raw = Buffer.from(file.data, "utf8");
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal/external attributes: 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

// ------------------------------------------------------------- workbook

export function buildXlsx<T>(sheet: XlsxSheet<T>): Buffer {
  const sheetName = escapeXml(safeSheetName(sheet.sheetName));
  return zip([
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES_XML },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(sheet) },
  ]);
}

// The download: attachment with the given filename, never cached.
export function xlsxResponse(filename: string, bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

// ============================================================ workbooks
//
// Several sheets, each with a few header rows (what the report is) above its
// table, a total row, and more kinds of cell: dates (real Excel dates, on the
// business's clock), percentages and quantities. Used by Restaurant Reports;
// buildXlsx above is untouched, so the retail exports stay as they were.
// workbookStream writes the same workbook as it goes, for exports too big to
// hold in memory (rows from an async source).

export type WorkbookCellKind = XlsxCellKind | "decimal" | "percent" | "date" | "datetime";
export type WorkbookValue = string | number | Date | null | undefined;
// A cell, or a cell with its own kind (a summary sheet's mixed column).
export type WorkbookCell = WorkbookValue | { value: WorkbookValue; kind: WorkbookCellKind };
export type WorkbookColumn = { header: string; width?: number; kind?: WorkbookCellKind };
export type WorkbookSheet = {
  name: string;
  // Header rows above the table: "Report", "Period", "Generated at"…
  info?: { label: string; value: WorkbookValue; kind?: WorkbookCellKind }[];
  columns: WorkbookColumn[];
  rows: Iterable<WorkbookCell[]> | AsyncIterable<WorkbookCell[]>;
  totals?: WorkbookCell[] | null;
};
// Dates are written on this clock (minutes ahead of UTC; Lagos: 60).
export type WorkbookOptions = { utcOffsetMinutes?: number; now?: Date };

// cellXfs of WORKBOOK_STYLES_XML: plain, then bold for the header and total rows.
const WB = {
  text: 0,
  bold: 1,
  money: 2,
  integer: 3,
  decimal: 4,
  percent: 5,
  date: 6,
  datetime: 7,
  boldMoney: 8,
  boldInteger: 9,
  boldDecimal: 10,
  boldPercent: 11,
  boldDate: 12,
  boldDatetime: 13,
} as const;

const PLAIN_FORMATS = [0, 0, 164, 3, 165, 166, 167, 168];
const BOLD_FORMATS = [164, 3, 165, 166, 167, 168];
const WORKBOOK_STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="5">` +
  `<numFmt numFmtId="164" formatCode="&quot;₦&quot;#,##0.00"/>` +
  `<numFmt numFmtId="165" formatCode="#,##0.###"/>` +
  `<numFmt numFmtId="166" formatCode="0.0%"/>` +
  `<numFmt numFmtId="167" formatCode="d mmm yyyy"/>` +
  `<numFmt numFmtId="168" formatCode="d mmm yyyy hh:mm"/>` +
  `</numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="${PLAIN_FORMATS.length + BOLD_FORMATS.length}">` +
  PLAIN_FORMATS.map((fmt, i) => `<xf numFmtId="${fmt}" fontId="${i === 1 ? 1 : 0}" fillId="0" borderId="0" xfId="0"${fmt ? ` applyNumberFormat="1"` : ""}${i === 1 ? ` applyFont="1"` : ""}/>`).join("") +
  BOLD_FORMATS.map((fmt) => `<xf numFmtId="${fmt}" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`).join("") +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

// An instant as an Excel date serial on the given clock (days since 30 Dec 1899).
export function excelDate(at: Date, utcOffsetMinutes = 0): number {
  return (at.getTime() + utcOffsetMinutes * 60_000) / 86_400_000 + 25569;
}

function styleOf(kind: WorkbookCellKind, bold: boolean): number {
  if (!bold) return kind === "text" ? WB.text : WB[kind];
  switch (kind) {
    case "money":
      return WB.boldMoney;
    case "integer":
      return WB.boldInteger;
    case "decimal":
      return WB.boldDecimal;
    case "percent":
      return WB.boldPercent;
    case "date":
      return WB.boldDate;
    case "datetime":
      return WB.boldDatetime;
    default:
      return WB.bold;
  }
}

// 14.3 → "0.143", exactly (a float ÷ 100 would write 0.14300000000000002).
export function fraction(percent: string): string {
  return String(parseFloat((Number(percent) / 100).toPrecision(15)));
}

// One cell. Numbers stay numbers (a Decimal string goes in as written);
// a percent is given as 12.5 and stored as 0.125; dates as serials.
export function workbookCell(ref: string, cell: WorkbookCell, columnKind: WorkbookCellKind, bold: boolean, utcOffsetMinutes: number): string {
  const own = cell !== null && typeof cell === "object" && !(cell instanceof Date);
  const value = own ? cell.value : cell;
  const kind = own ? cell.kind : columnKind;
  if (value === null || value === undefined || value === "") return "";
  const s = styleOf(kind, bold);
  if ((kind === "date" || kind === "datetime") && value instanceof Date) return `<c r="${ref}" s="${s}"><v>${excelDate(value, utcOffsetMinutes)}</v></c>`;
  if (kind === "percent" && NUMBER.test(String(value))) return `<c r="${ref}" s="${s}"><v>${fraction(String(value))}</v></c>`;
  if ((kind === "money" || kind === "integer" || kind === "decimal") && NUMBER.test(String(value))) return `<c r="${ref}" s="${s}"><v>${String(value)}</v></c>`;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"${bold ? ` s="${WB.bold}"` : ""}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

const rowXml = (r: number, cells: readonly WorkbookCell[], kinds: readonly WorkbookCellKind[], bold: boolean, offset: number) =>
  `<row r="${r}">${cells.map((v, i) => workbookCell(`${columnLetter(i)}${r}`, v, kinds[i] ?? "text", bold, offset)).join("")}</row>`;

// The row a sheet's column headings are on (below its header rows).
export const tableHeaderRow = (sheet: Pick<WorkbookSheet, "info">) => (sheet.info?.length ? sheet.info.length + 2 : 1);

// A sheet's XML in pieces, the rows as they come.
async function* sheetPieces(sheet: WorkbookSheet, offset: number): AsyncGenerator<string> {
  const info = sheet.info ?? [];
  const headerRow = tableHeaderRow(sheet);
  const widths = sheet.columns.map((c, i) => Math.max(c.width ?? 16, i === 0 && info.length ? 16 : 0));
  yield `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>`;
  let r = 0;
  for (const line of info) {
    r += 1;
    yield `<row r="${r}">${workbookCell(`A${r}`, line.label, "text", true, offset)}${workbookCell(`B${r}`, line.value, line.kind ?? "text", false, offset)}</row>`;
  }
  r = headerRow;
  yield `<row r="${r}">${sheet.columns.map((c, i) => workbookCell(`${columnLetter(i)}${r}`, c.header, "text", true, offset)).join("")}</row>`;
  const kinds = sheet.columns.map((c) => c.kind ?? "text");
  let chunk = "";
  for await (const cells of sheet.rows as AsyncIterable<WorkbookCell[]>) {
    r += 1;
    chunk += rowXml(r, cells, kinds, false, offset);
    if (chunk.length > 64_000) {
      yield chunk;
      chunk = "";
    }
  }
  if (sheet.totals) chunk += rowXml(r + 1, sheet.totals, kinds, true, offset);
  yield `${chunk}</sheetData></worksheet>`;
}

function workbookParts(sheets: readonly WorkbookSheet[]): { name: string; data: string }[] {
  const names = new Set<string>();
  const sheetName = (name: string) => {
    let base = safeSheetName(name);
    for (let n = 2; names.has(base); n++) base = `${safeSheetName(name).slice(0, 28)} ${n}`;
    names.add(base);
    return escapeXml(base);
  };
  return [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheets.map((s, i) => `<sheet name="${sheetName(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", data: WORKBOOK_STYLES_XML },
  ];
}

// Every sheet's rows at hand (or a small async source): the whole file.
export async function buildWorkbook(sheets: readonly WorkbookSheet[], options: WorkbookOptions = {}): Promise<Buffer> {
  const offset = options.utcOffsetMinutes ?? 0;
  const files = workbookParts(sheets);
  for (const [i, sheet] of sheets.entries()) {
    let data = "";
    for await (const piece of sheetPieces(sheet, offset)) data += piece;
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data });
  }
  return zip(files, options.now);
}

function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The same workbook, written as it goes: each part deflated piece by piece,
// its sizes and CRC after it (zip data descriptors), the directory last.
export function workbookStream(sheets: readonly WorkbookSheet[], options: WorkbookOptions = {}): ReadableStream<Uint8Array> {
  const offset = options.utcOffsetMinutes ?? 0;
  const now = options.now ?? new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  async function* bytes(): AsyncGenerator<Buffer> {
    const entries: { name: Buffer; crc: number; packed: number; raw: number; offset: number }[] = [];
    let at = 0;
    const parts: { name: string; pieces: AsyncIterable<string> | string[] }[] = [
      ...workbookParts(sheets).map((p) => ({ name: p.name, pieces: [p.data] })),
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, pieces: sheetPieces(s, offset) })),
    ];
    for (const part of parts) {
      const name = Buffer.from(part.name, "utf8");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0808, 6); // UTF-8 names; sizes in a data descriptor
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(dosTime, 10);
      local.writeUInt16LE(dosDate, 12);
      local.writeUInt16LE(name.length, 26);
      yield local;
      yield name;
      const start = at;
      at += local.length + name.length;

      const deflate = createDeflateRaw();
      const out: Buffer[] = [];
      deflate.on("data", (b: Buffer) => out.push(b));
      let crc = 0;
      let raw = 0;
      let packed = 0;
      const take = () => {
        const ready = out.splice(0);
        for (const b of ready) packed += b.length;
        return ready;
      };
      for await (const piece of part.pieces) {
        const buf = Buffer.from(piece, "utf8");
        crc = crc32Update(crc, buf);
        raw += buf.length;
        deflate.write(buf);
        await new Promise<void>((resolve) => deflate.flush(zlibConstants.Z_SYNC_FLUSH, () => resolve()));
        yield* take();
      }
      await new Promise<void>((resolve) => {
        deflate.once("end", () => resolve());
        deflate.end();
      });
      yield* take();
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(packed, 8);
      descriptor.writeUInt32LE(raw, 12);
      yield descriptor;
      at += packed + descriptor.length;
      entries.push({ name, crc, packed, raw, offset: start });
    }
    const centrals: Buffer[] = [];
    for (const e of entries) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0808, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt16LE(dosTime, 12);
      central.writeUInt16LE(dosDate, 14);
      central.writeUInt32LE(e.crc, 16);
      central.writeUInt32LE(e.packed, 20);
      central.writeUInt32LE(e.raw, 24);
      central.writeUInt16LE(e.name.length, 28);
      central.writeUInt32LE(e.offset, 42);
      centrals.push(central, e.name);
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(at, 16);
    yield directory;
    yield end;
  }

  const it = bytes();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value));
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}

// The streamed download (no Content-Length: it isn't known until the end).
export function xlsxStreamResponse(filename: string, body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
