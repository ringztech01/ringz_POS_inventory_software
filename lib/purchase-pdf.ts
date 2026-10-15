import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { COMPANY } from "@/lib/company";
import { formatDateOnly, formatNaira } from "@/lib/format";
import type { PurchaseDocument } from "@/app/(dashboard)/purchases/queries";
import { PAYMENT_TYPE_LABELS, PURCHASE_STATUS_LABELS } from "@/components/purchases/purchase-display";

// Server-side PDF for a purchase (the "Download PDF" action). Renders the
// same PurchaseDocument the details page renders, so the two always agree.
//
// The standard PDF fonts have no ₦ glyph, so the app's own IBM Plex fonts
// (assets/fonts, SIL Open Font License) are embedded — subset to only the
// glyphs used, which keeps the file small.

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FILES = {
  sans: "IBMPlexSans-Regular.ttf",
  sansSemi: "IBMPlexSans-SemiBold.ttf",
  sansBold: "IBMPlexSans-Bold.ttf",
  mono: "IBMPlexMono-Regular.ttf",
  monoSemi: "IBMPlexMono-SemiBold.ttf",
} as const;

type FontKey = keyof typeof FONT_FILES;
type Fonts = Record<FontKey, PDFFont>;

// Font files are read once per server process.
let fontBytesPromise: Promise<Record<FontKey, Uint8Array>> | null = null;

function loadFontBytes(): Promise<Record<FontKey, Uint8Array>> {
  const keys = Object.keys(FONT_FILES) as FontKey[];
  fontBytesPromise ??= Promise.all(keys.map((key) => readFile(path.join(FONT_DIR, FONT_FILES[key]))))
    .then((files) => {
      const record = {} as Record<FontKey, Uint8Array>;
      keys.forEach((key, i) => {
        record[key] = new Uint8Array(files[i]);
      });
      return record;
    })
    .catch((error) => {
      fontBytesPromise = null; // don't cache a failed read
      throw error;
    });
  return fontBytesPromise;
}

function hex(color: string) {
  const n = parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Same palette as components/layout/theme.ts and the RingzPOS designs.
const C = {
  teal: hex("#0f7d6a"),
  tealDark: hex("#0a6355"),
  tealTint: hex("#eff8f6"),
  ink: hex("#171b1c"),
  text: hex("#363d3f"),
  slate: hex("#4d5659"),
  slateMid: hex("#6d777a"),
  slateLight: hex("#97a1a4"),
  border: hex("#eceff0"),
  bgInput: hex("#fafbfb"),
};

const STATUS_TEXT_COLOR = {
  RECEIVED: hex("#0b6146"),
  ORDERED: hex("#17518c"),
  PENDING: hex("#7d5106"),
} as const;

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 36;
const BOTTOM = MARGIN + FOOTER_H;

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 0 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line is hard-broken.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderPurchasePdf(purchase: PurchaseDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Purchase ${purchase.reference}`);
  pdf.setAuthor(COMPANY.name);
  pdf.setCreator(COMPANY.name);

  const bytes = await loadFontBytes();
  const fonts = Object.fromEntries(
    await Promise.all(
      (Object.keys(bytes) as FontKey[]).map(async (key) => [key, await pdf.embedFont(bytes[key], { subset: true })] as const),
    ),
  ) as Fonts;

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  // `y` is the top of the next thing to draw, measured from the page bottom.
  let y = PAGE_H - MARGIN;

  function text(
    value: string,
    x: number,
    top: number,
    { font = fonts.sans, size = 9, color = C.text, align = "left", width = 0 }: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "right" | "center";
      width?: number;
    } = {},
  ) {
    const w = font.widthOfTextAtSize(value, size);
    const drawX = align === "right" ? x + width - w : align === "center" ? x + (width - w) / 2 : x;
    // Baseline sits ~0.8em below the line's top.
    page.drawText(value, { x: drawX, y: top - size * 0.8, size, font, color });
  }

  function rect(x: number, top: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border = true) {
    page.drawRectangle({
      x,
      y: top - h,
      width: w,
      height: h,
      color: fill,
      borderColor: border ? C.border : undefined,
      borderWidth: border ? 0.75 : 0,
    });
  }

  function hline(x: number, top: number, w: number, color = C.border) {
    page.drawLine({ start: { x, y: top }, end: { x: x + w, y: top }, thickness: 0.75, color });
  }

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }

  // Starts a new page if `space` points won't fit above the footer.
  function ensure(space: number): boolean {
    if (y - space >= BOTTOM) return false;
    newPage();
    return true;
  }

  function overline(label: string, x: number, top: number) {
    text(label.toUpperCase(), x, top, { font: fonts.sansSemi, size: 7.5, color: C.slateMid });
  }

  // ---- Header
  text(COMPANY.name, MARGIN, y, { font: fonts.sansBold, size: 18, color: C.teal });
  text("PURCHASE DETAILS", MARGIN, y + 1, { font: fonts.sansSemi, size: 7.5, color: C.slateMid, align: "right", width: CONTENT_W });
  text(purchase.reference, MARGIN, y - 12, { font: fonts.sansBold, size: 15, color: C.ink, align: "right", width: CONTENT_W });
  y -= 36;
  hline(MARGIN, y, CONTENT_W);
  y -= 18;

  // ---- Supplier / Company / Purchase info (three bordered cards)
  const gap = 12;
  const colW = (CONTENT_W - gap * 2) / 3;
  const pad = 10;
  const innerW = colW - pad * 2;
  const lineH = 13;

  type Line = { value: string; font: PDFFont; size: number; color: ReturnType<typeof rgb>; label?: string };
  const contact = (name: string, email: string, phone: string, address: string): Line[] => [
    { value: fit(name, fonts.sansSemi, 9.5, innerW), font: fonts.sansSemi, size: 9.5, color: C.ink },
    { value: fit(email, fonts.sans, 8.5, innerW), font: fonts.sans, size: 8.5, color: C.slate },
    { value: fit(phone, fonts.mono, 8.5, innerW), font: fonts.mono, size: 8.5, color: C.slate },
    ...wrap(address, fonts.sans, 8.5, innerW).map((value) => ({ value, font: fonts.sans, size: 8.5, color: C.slate })),
  ];
  const labelW = 58;
  const infoValueW = innerW - labelW;
  const info: Line[] = [
    { label: "Reference", value: fit(purchase.reference, fonts.mono, 8.5, infoValueW), font: fonts.mono, size: 8.5, color: C.text },
    { label: "Date", value: formatDateOnly(purchase.date), font: fonts.mono, size: 8.5, color: C.slate },
    {
      label: "Status",
      value: PURCHASE_STATUS_LABELS[purchase.status],
      font: fonts.sansSemi,
      size: 8.5,
      color: STATUS_TEXT_COLOR[purchase.status],
    },
    { label: "Warehouse", value: fit(purchase.warehouse.name, fonts.sans, 8.5, infoValueW), font: fonts.sans, size: 8.5, color: C.slate },
    { label: "Payment", value: PAYMENT_TYPE_LABELS[purchase.paymentType], font: fonts.sansSemi, size: 8.5, color: C.tealDark },
  ];
  const cards: { title: string; lines: Line[] }[] = [
    {
      title: "Supplier info",
      lines: contact(purchase.supplier.name, purchase.supplier.email, purchase.supplier.phoneNumber, purchase.supplier.address),
    },
    { title: "Company info", lines: contact(COMPANY.name, COMPANY.email, COMPANY.phone, COMPANY.address) },
    { title: "Purchase info", lines: info },
  ];
  const headH = 22;
  const cardH = headH + pad + Math.max(...cards.map((card) => card.lines.length)) * lineH + pad - 2;

  cards.forEach((card, i) => {
    const x = MARGIN + i * (colW + gap);
    rect(x, y, colW, cardH);
    rect(x, y, colW, headH, C.bgInput);
    overline(card.title, x + pad, y - 8);
    let lineTop = y - headH - pad;
    for (const line of card.lines) {
      if (line.label) {
        text(line.label, x + pad, lineTop, { font: fonts.sansSemi, size: 8.5, color: C.text });
        text(line.value, x + pad + labelW, lineTop, { font: line.font, size: line.size, color: line.color });
      } else {
        text(line.value, x + pad, lineTop, { font: line.font, size: line.size, color: line.color });
      }
      lineTop -= lineH;
    }
  });
  y -= cardH + 22;

  // ---- Order summary table
  const fixed = { net: 62, qty: 50, unit: 62, discount: 56, tax: 56, subtotal: 74 };
  const columns = [
    { label: "Product", width: CONTENT_W - Object.values(fixed).reduce((a, b) => a + b, 0), right: false },
    { label: "Net unit cost", width: fixed.net, right: true },
    { label: "Quantity", width: fixed.qty, right: true },
    { label: "Unit cost", width: fixed.unit, right: true },
    { label: "Discount", width: fixed.discount, right: true },
    { label: "Tax", width: fixed.tax, right: true },
    { label: "Subtotal", width: fixed.subtotal, right: true },
  ];
  const cellPad = 6;
  const headerRowH = 22;
  const rowH = 30;

  function tableHeader() {
    rect(MARGIN, y, CONTENT_W, headerRowH, C.bgInput);
    let x = MARGIN;
    for (const column of columns) {
      text(column.label.toUpperCase(), x + cellPad, y - 8, {
        font: fonts.sansSemi,
        size: 6.5,
        color: C.slateMid,
        align: column.right ? "right" : "left",
        width: column.width - cellPad * 2,
      });
      x += column.width;
    }
    y -= headerRowH;
  }

  ensure(14 + headerRowH + rowH);
  overline("Order summary", MARGIN, y);
  y -= 14;
  tableHeader();

  for (const item of purchase.items) {
    if (ensure(rowH)) tableHeader();
    rect(MARGIN, y, CONTENT_W, rowH);
    const cells = [
      formatNaira(item.netUnitCost),
      `${item.quantity} ${item.purchaseUnit}`,
      formatNaira(item.unitCost),
      formatNaira(item.discount),
      formatNaira(item.tax),
      formatNaira(item.subtotal),
    ];
    const productW = columns[0].width - cellPad * 2;
    text(fit(item.code, fonts.monoSemi, 8, productW), MARGIN + cellPad, y - 6, { font: fonts.monoSemi, size: 8, color: C.ink });
    text(fit(item.name, fonts.sans, 8, productW), MARGIN + cellPad, y - 17, { font: fonts.sans, size: 8, color: C.slate });
    let x = MARGIN + columns[0].width;
    cells.forEach((value, i) => {
      const column = columns[i + 1];
      const strong = i === 0 || i === 5;
      text(value, x + cellPad, y - 11, {
        font: strong ? fonts.monoSemi : fonts.mono,
        size: 8,
        color: strong ? C.ink : C.slate,
        align: "right",
        width: column.width - cellPad * 2,
      });
      x += column.width;
    });
    y -= rowH;
  }
  y -= 18;

  // ---- Totals box
  const totals: [string, string][] = [
    ["Order Tax", `${formatNaira(purchase.orderTaxAmount)} (${purchase.orderTaxRate}%)`],
    ["Discount", formatNaira(purchase.discount)],
    ["Shipping", formatNaira(purchase.shipping)],
    ["Grand Total", formatNaira(purchase.grandTotal)],
  ];
  const totalsW = 240;
  const totalsRowH = 24;
  ensure(totals.length * totalsRowH);
  const totalsX = MARGIN + CONTENT_W - totalsW;
  totals.forEach(([label, value], i) => {
    const last = i === totals.length - 1;
    rect(totalsX, y, totalsW, totalsRowH, last ? C.tealTint : undefined);
    text(label, totalsX + 12, y - 8, {
      font: last ? fonts.sansSemi : fonts.sans,
      size: last ? 10 : 9,
      color: last ? C.tealDark : C.slate,
    });
    text(value, totalsX + 12, y - 8, {
      font: last ? fonts.monoSemi : fonts.mono,
      size: last ? 10 : 9,
      color: last ? C.tealDark : C.text,
      align: "right",
      width: totalsW - 24,
    });
    y -= totalsRowH;
  });

  // ---- Notes
  if (purchase.notes) {
    y -= 22;
    const lines = wrap(purchase.notes, fonts.sans, 9, CONTENT_W);
    ensure(14 + Math.min(lines.length, 3) * 13);
    overline("Notes", MARGIN, y);
    y -= 14;
    for (const line of lines) {
      ensure(13);
      text(line, MARGIN, y, { font: fonts.sans, size: 9, color: C.slate });
      y -= 13;
    }
  }

  // ---- Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    hline(MARGIN, MARGIN + 14, CONTENT_W);
    text(`${COMPANY.name} · Purchase ${purchase.reference}`, MARGIN, MARGIN + 6, { size: 7.5, color: C.slateLight });
    text(`Page ${i + 1} of ${pages.length}`, MARGIN, MARGIN + 6, {
      size: 7.5,
      color: C.slateLight,
      align: "right",
      width: CONTENT_W,
    });
  });

  return pdf.save();
}
