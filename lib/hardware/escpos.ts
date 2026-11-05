import { encoderFor } from "./codePages";

// ESC/POS bytes for 58 / 80 mm thermal printers — built on the app server,
// sent as-is by the hardware bridge. Pure (no I/O), so tickets are tested
// byte for byte.

export const PAPER_WIDTHS = [58, 80] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

// Characters per line in Font A: 32 on 58 mm, 48 on 80 mm.
export const lineWidth = (paper: number) => (paper === 58 ? 32 : 48);

// Code pages (ESC t n): the common ones on Epson-compatible printers.
export const CODE_PAGES = {
  PC437: { n: 0, label: "PC437 · USA, standard Europe" },
  PC850: { n: 2, label: "PC850 · Multilingual" },
  PC852: { n: 18, label: "PC852 · Latin 2" },
  PC858: { n: 19, label: "PC858 · Euro" },
  PC860: { n: 3, label: "PC860 · Portuguese" },
  PC863: { n: 4, label: "PC863 · Canadian French" },
  PC865: { n: 5, label: "PC865 · Nordic" },
  PC866: { n: 17, label: "PC866 · Cyrillic" },
  WPC1252: { n: 16, label: "WPC1252 · Windows Latin 1" },
} as const;
export type CodePage = keyof typeof CODE_PAGES;
export const isCodePage = (value: string): value is CodePage => Object.hasOwn(CODE_PAGES, value);

export type Cut = "FULL" | "PARTIAL" | "NONE";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Typographic characters a code page may not have, as plain ASCII.
const ASCII_STAND_INS: Record<string, string> = {
  "·": "-", "•": "*", "—": "-", "–": "-", "−": "-", "…": "...", "‘": "'", "’": "'", "“": '"', "”": '"', "»": ">>", "«": "<<", "×": "x", "₦": "N", "€": "EUR",
};

// Text → bytes for the printer's code page (lib/hardware/codePages.ts): a
// character the page has prints as itself; one it hasn't, as its ASCII
// stand-in (₦ is "N" — no code page has it); anything else as "?".
export function encodeText(text: string, codePage: CodePage): number[] {
  const out: number[] = [];
  const table = encoderFor(codePage);
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 63;
    if ((code >= 0x20 && code < 0x7f) || code === 0x0a) out.push(code);
    else if (table.has(ch)) out.push(table.get(ch)!);
    else if (ASCII_STAND_INS[ch]) out.push(...[...ASCII_STAND_INS[ch]].map((c) => c.charCodeAt(0)));
    else out.push(0x3f);
  }
  return out;
}

export class EscPos {
  private readonly out: number[] = [];
  private readonly codePage: CodePage;

  constructor(codePage: CodePage = "PC437") {
    this.codePage = codePage;
    // ESC @ (reset), then the code page.
    this.out.push(ESC, 0x40, ESC, 0x74, CODE_PAGES[codePage].n);
  }

  align(how: "left" | "center" | "right"): this {
    this.out.push(ESC, 0x61, how === "left" ? 0 : how === "center" ? 1 : 2);
    return this;
  }

  bold(on: boolean): this {
    this.out.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  // 1–8 × width and height (GS ! n).
  size(width: number, height: number): this {
    const w = Math.max(1, Math.min(8, Math.round(width))) - 1;
    const h = Math.max(1, Math.min(8, Math.round(height))) - 1;
    this.out.push(GS, 0x21, (w << 4) | h);
    return this;
  }

  text(value: string): this {
    this.out.push(...encodeText(value, this.codePage));
    return this;
  }

  line(value = ""): this {
    return this.text(value).feed(1);
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) this.out.push(LF);
    return this;
  }

  // Feed past the tear bar, then cut (GS V 66 n: feed n and cut).
  cut(how: Cut): this {
    if (how === "NONE") return this.feed(4);
    this.out.push(GS, 0x56, how === "FULL" ? 65 : 66, 3);
    return this;
  }

  // Cash drawer kick (ESC p m t1 t2): pin 2 → m 0, pin 5 → m 1; 50 ms on, 500 ms off.
  kickDrawer(pin: 2 | 5): this {
    this.out.push(ESC, 0x70, pin === 5 ? 1 : 0, 25, 250);
    return this;
  }

  raw(bytes: readonly number[]): this {
    this.out.push(...bytes);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

// "Left text ......... right" in `width` characters.
export function columns(left: string, right: string, width: number): string {
  const space = width - right.length;
  const l = left.length > space - 1 ? `${left.slice(0, Math.max(0, space - 2))}…` : left;
  return `${l}${" ".repeat(Math.max(1, width - l.length - right.length))}${right}`;
}
