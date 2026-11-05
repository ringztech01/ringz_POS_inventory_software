import { columns, EscPos, lineWidth, type CodePage, type Cut } from "./escpos";
import { qrRaster, rasterCommand, type Raster } from "./raster";
import { testPrintBytes, type TestPrintTarget } from "./testPrint";

// The ESC/POS tickets: KOT (and VOID KOT), pre-bill ("NOT A RECEIPT") and
// receipt — rendered when a job prints, for the printer it prints on (width,
// code page, cut), with the business look (TicketLook: logo, header and
// footer text, QR code, kitchen font size, prices on KOT) and the REPRINT /
// REROUTED FROM marks. Pure: data in, bytes out — the same function draws
// the Settings preview (escposPreview.ts).
//
//   receipt, pre-bill   logo, the business header, the ticket, totals, the
//                       footer, the QR code
//   KOT                 the business name, station, table, lines (large
//                       when set; prices when set) — no logo, footer or QR:
//                       kitchen paper

export type TicketLook = {
  // The business header, line by line (the first — its name — in bold).
  header: string[];
  // Under the receipt and pre-bill ("Thank you…", opening hours, Wi-Fi).
  footer: string[];
  // The logo, when switched on and uploaded.
  logo: Raster | null;
  // What the QR code under the receipt and pre-bill holds, when switched on.
  qr: string | null;
  // KOT lines in large type.
  kitchenLarge: boolean;
  // Prices on KOT lines.
  kotPrices: boolean;
};

export const DEFAULT_LOOK: TicketLook = { header: [], footer: [], logo: null, qr: null, kitchenLarge: false, kotPrices: false };

export type KotTicket = {
  ref: string;
  type: "NEW" | "VOID";
  note: string | null;
  station: string;
  table: string;
  orderRef: string;
  orderType: string;
  area: string | null;
  guests: number;
  waiter: string;
  createdAt: string;
  // `amount`: the line's price (shown when the look says so).
  lines: { quantity: number; name: string; modifiers: string | null; note: string | null; amount?: string }[];
  items: number;
};

export type PrebillTicket = {
  company: { name: string; address: string; phone: string };
  table: string;
  ref: string;
  orderType: string;
  waiter: string;
  guests: number;
  printedAt: string;
  lines: { quantity: number; name: string; amount: string; modifiers: { name: string; price: string }[]; note: string | null }[];
  // [label, value] rows: Sub total, Discount, Service charge, Tax.
  totals: [string, string][];
  total: string;
  split: { title: string; parts: { label: string; amount: string; items: string }[] } | null;
};

export type ReceiptTicket = {
  title: string;
  place: string;
  reference: string;
  date: string;
  customer: string;
  details: [string, string][];
  items: { name: string; quantity: number; unitCost: string; subtotal: string }[];
  totals: [string, string][];
  grandTotal: string;
  payments: [string, string][];
  due: string;
  status: string | null;
  afterPayments: [string, string][];
  footer: string;
};

export type TicketTemplate = "KOT" | "PREBILL" | "RECEIPT" | "TEST";

export type RenderOptions = {
  paperWidth: number;
  codePage: CodePage;
  cut: Cut;
  // "REPRINT" or "REPRINT #2"; null for a first print.
  reprint: string | null;
  // The printer it was meant for, when it printed on a fallback.
  reroutedFrom: string | null;
  look?: TicketLook;
};

const appTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(",", "");

// The marks every ticket can carry, at the top.
function marks(p: EscPos, o: RenderOptions) {
  if (o.reroutedFrom) p.align("center").bold(true).line(`REROUTED FROM ${o.reroutedFrom}`.toUpperCase()).bold(false);
  if (o.reprint) p.align("center").bold(true).line(`*** ${o.reprint} ***`).bold(false);
}

// Text that wraps at the width, each line indented.
export function wrap(text: string, width: number, indent = 0): string[] {
  const out: string[] = [];
  const room = Math.max(8, width - indent);
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line ? line.length + 1 : 0) + word.length > room) {
        if (line) out.push(line);
        line = word.length > room ? word.slice(0, room) : word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out.map((l) => " ".repeat(indent) + l);
}

// Logo and header, centred: the first header line is the name, in bold.
function businessTop(p: EscPos, look: TicketLook, w: number, fallbackName: string, fallbackLines: string[]) {
  p.align("center");
  if (look.logo) p.raw(rasterCommand(look.logo)).feed(1);
  const [name, ...rest] = look.header.length ? look.header : [fallbackName, ...fallbackLines];
  if (name) p.bold(true).size(1, 2).line(name.slice(0, w)).size(1, 1).bold(false);
  for (const line of rest) for (const l of wrap(line, w)) p.line(l);
}

// Footer lines and the QR code, centred, at the bottom.
function businessBottom(p: EscPos, look: TicketLook, w: number, fallbackFooter: string[]) {
  p.align("center");
  const footer = look.footer.length ? look.footer : fallbackFooter;
  if (footer.length) p.feed(1);
  for (const line of footer) for (const l of wrap(line, w)) p.line(l);
  if (look.qr) p.feed(1).raw(rasterCommand(qrRaster(look.qr))).feed(1);
}

export function renderKot(d: KotTicket, o: RenderOptions): Uint8Array {
  const look = o.look ?? DEFAULT_LOOK;
  const w = lineWidth(o.paperWidth);
  const big = Math.floor(w / 2);
  const p = new EscPos(o.codePage);
  marks(p, o);
  p.align("center");
  if (look.header[0]) p.line(look.header[0].slice(0, w));
  p.bold(true).line(d.station.toUpperCase());
  if (d.type === "VOID") p.size(2, 2).line("*** VOID ***").size(1, 1);
  p.size(2, 2).line(d.table.slice(0, big)).size(1, 1).bold(false).align("left");
  p.bold(true).line(columns(d.ref, d.orderRef, w)).bold(false);
  p.line(columns(appTime(d.createdAt), d.waiter, w));
  p.line([d.orderType, d.area, `${d.guests} ${d.guests === 1 ? "guest" : "guests"}`].filter(Boolean).join(" · "));
  p.line("-".repeat(w));
  if (d.note) p.bold(true).line(d.note).bold(false);
  // Large: double width and height (half as many characters a line).
  const lineW = look.kitchenLarge ? big : w;
  for (const line of d.lines) {
    p.bold(true).size(look.kitchenLarge ? 2 : 1, 2);
    const price = look.kotPrices && line.amount ? line.amount : null;
    const head = wrap(line.name, lineW - 4 - (price ? price.length + 1 : 0));
    const first = `${`${line.quantity}x`.padEnd(4)}${head[0] ?? ""}`;
    p.line(price ? columns(first, price, lineW) : first);
    for (const more of head.slice(1)) p.line(`    ${more}`);
    p.size(1, 1).bold(false);
    if (line.modifiers) for (const l of wrap(`+ ${line.modifiers}`, w, 4)) p.line(l);
    if (line.note) for (const l of wrap(`» ${line.note}`, w, 4)) p.line(l);
  }
  p.line("-".repeat(w)).bold(true).line(columns(d.type === "VOID" ? "Items voided" : "Items", String(d.items), w)).bold(false);
  return p.cut(o.cut).bytes();
}

export function renderPrebill(d: PrebillTicket, o: RenderOptions): Uint8Array {
  const look = o.look ?? DEFAULT_LOOK;
  const w = lineWidth(o.paperWidth);
  const p = new EscPos(o.codePage);
  marks(p, o);
  businessTop(p, look, w, d.company.name, [d.company.address, d.company.phone].filter(Boolean));
  p.feed(1).bold(true).line("*** NOT A RECEIPT ***").size(2, 2).line(d.table.slice(0, Math.floor(w / 2))).size(1, 1).bold(false).align("left");
  p.bold(true).line(columns(d.ref, d.orderType, w)).bold(false);
  p.line(columns(appTime(d.printedAt), d.waiter, w));
  p.line(`${d.guests} ${d.guests === 1 ? "guest" : "guests"}`);
  p.line("-".repeat(w));
  if (d.lines.length === 0) p.line("Nothing to bill yet.");
  for (const line of d.lines) {
    p.line(columns(`${line.quantity}x ${line.name}`, line.amount, w));
    for (const m of line.modifiers) p.line(`   + ${m.name}${m.price ? ` ${m.price}` : ""}`);
    if (line.note) for (const l of wrap(`» ${line.note}`, w, 3)) p.line(l);
  }
  p.line("-".repeat(w));
  for (const [label, value] of d.totals) p.line(columns(label, value, w));
  p.bold(true).size(1, 2).line(columns("TOTAL", d.total, w)).size(1, 1).bold(false);
  if (d.split) {
    p.line("-".repeat(w)).bold(true).line(d.split.title).bold(false);
    for (const part of d.split.parts) {
      p.line(columns(part.label, part.amount, w));
      if (part.items) for (const l of wrap(part.items, w, 2)) p.line(l);
    }
  }
  p.feed(1).align("center").line("This is not a receipt.").line("Your receipt comes when you pay.");
  businessBottom(p, look, w, []);
  return p.cut(o.cut).bytes();
}

export function renderReceipt(d: ReceiptTicket, o: RenderOptions): Uint8Array {
  const look = o.look ?? DEFAULT_LOOK;
  const w = lineWidth(o.paperWidth);
  const p = new EscPos(o.codePage);
  marks(p, o);
  businessTop(p, look, w, d.title, []);
  p.line(d.place).align("left");
  p.line("-".repeat(w));
  p.line(columns("Receipt", d.reference, w)).line(columns("Date", d.date, w)).line(columns("Customer", d.customer, w));
  for (const [label, value] of d.details) p.line(columns(label, value, w));
  p.line("-".repeat(w));
  for (const item of d.items) {
    p.bold(true);
    for (const l of wrap(item.name, w)) p.line(l);
    p.bold(false).line(columns(`  ${item.quantity} x ${item.unitCost}`, item.subtotal, w));
  }
  p.line("-".repeat(w));
  for (const [label, value] of d.totals) p.line(columns(label, value, w));
  p.bold(true).size(1, 2).line(columns("Total", d.grandTotal, w)).size(1, 1).bold(false);
  p.line("-".repeat(w));
  for (const [label, value] of d.payments) p.line(columns(label, value, w));
  p.line(columns("Due", d.due, w));
  if (d.status) p.line(columns("Status", d.status, w));
  for (const [label, value] of d.afterPayments) p.line(columns(label, value, w));
  businessBottom(p, look, w, [d.footer]);
  return p.cut(o.cut).bytes();
}

// A job's bytes: its template and data, for this printer, `copies` times.
export function renderTicket(template: string, data: unknown, o: RenderOptions, copies = 1): Uint8Array {
  let one: Uint8Array;
  switch (template as TicketTemplate) {
    case "KOT":
      one = renderKot(data as KotTicket, o);
      break;
    case "PREBILL":
      one = renderPrebill(data as PrebillTicket, o);
      break;
    case "RECEIPT":
      one = renderReceipt(data as ReceiptTicket, o);
      break;
    case "TEST": {
      const t = data as Omit<TestPrintTarget, "paperWidth" | "codePage" | "cut"> & { when: string };
      one = testPrintBytes({ ...t, paperWidth: o.paperWidth, codePage: o.codePage, cut: o.cut }, t.when);
      break;
    }
    default:
      throw new Error(`Unknown ticket template "${template}".`);
  }
  if (copies <= 1) return one;
  const out = new Uint8Array(one.length * copies);
  for (let i = 0; i < copies; i++) out.set(one, i * one.length);
  return out;
}
