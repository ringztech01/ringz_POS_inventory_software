import { decodeByte } from "./codePages";
import { CODE_PAGES } from "./escpos";
import type { Raster } from "./raster";

// The ESC/POS bytes a ticket sends, read back as what the printer would put
// on paper — the Settings preview shows exactly this, so it can't drift from
// the print. Only the commands the tickets use: ESC @, ESC t, ESC a, ESC E,
// GS !, LF, GS v 0 (images), GS V (cut), ESC p (drawer).

export type Run = { text: string; bold: boolean; w: number; h: number };
export type Align = "left" | "center" | "right";
export type PreviewBlock =
  | { kind: "line"; align: Align; runs: Run[] }
  | { kind: "image"; align: Align; raster: Raster }
  | { kind: "cut"; partial: boolean }
  | { kind: "drawer"; pin: 2 | 5 };

const PAGE_BY_N = new Map(Object.entries(CODE_PAGES).map(([key, page]) => [page.n as number, key]));

export function previewEscPos(bytes: Uint8Array): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let align: Align = "left";
  let lineAlign: Align | null = null;
  let bold = false;
  let w = 1;
  let h = 1;
  let codePage = "PC437";
  let runs: Run[] = [];

  const put = (ch: string) => {
    if (lineAlign === null) lineAlign = align;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold && last.w === w && last.h === h) last.text += ch;
    else runs.push({ text: ch, bold, w, h });
  };
  const flush = () => {
    blocks.push({ kind: "line", align: lineAlign ?? align, runs });
    runs = [];
    lineAlign = null;
  };
  const flushIfOpen = () => {
    if (runs.length) flush();
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) flush();
    else if (b === 0x1b) {
      const cmd = bytes[i + 1];
      if (cmd === 0x40) {
        align = "left";
        bold = false;
        w = h = 1;
        codePage = "PC437";
        i += 1;
      } else if (cmd === 0x74) {
        codePage = PAGE_BY_N.get(bytes[i + 2]) ?? codePage;
        i += 2;
      } else if (cmd === 0x61) {
        const n = bytes[i + 2] % 48;
        align = n === 1 ? "center" : n === 2 ? "right" : "left";
        i += 2;
      } else if (cmd === 0x45) {
        bold = (bytes[i + 2] & 1) === 1;
        i += 2;
      } else if (cmd === 0x70) {
        flushIfOpen();
        blocks.push({ kind: "drawer", pin: bytes[i + 2] % 48 === 1 ? 5 : 2 });
        i += 4;
      } else i += 1;
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x21) {
        const n = bytes[i + 2];
        w = (n >> 4) + 1;
        h = (n & 0x0f) + 1;
        i += 2;
      } else if (cmd === 0x56) {
        flushIfOpen();
        const m = bytes[i + 2];
        blocks.push({ kind: "cut", partial: m === 1 || m === 49 || m === 66 });
        i += m >= 65 ? 3 : 2;
      } else if (cmd === 0x76 && bytes[i + 2] === 0x30) {
        flushIfOpen();
        const xBytes = bytes[i + 4] | (bytes[i + 5] << 8);
        const rows = bytes[i + 6] | (bytes[i + 7] << 8);
        const data = bytes.slice(i + 8, i + 8 + xBytes * rows);
        const last = blocks[blocks.length - 1];
        // A tall image comes in bands: join them back up.
        if (last && last.kind === "image" && last.raster.width === xBytes * 8 && last.align === align) {
          const joined = new Uint8Array(last.raster.data.length + data.length);
          joined.set(last.raster.data);
          joined.set(data, last.raster.data.length);
          last.raster = { width: xBytes * 8, height: last.raster.height + rows, data: joined };
        } else blocks.push({ kind: "image", align, raster: { width: xBytes * 8, height: rows, data } });
        i += 7 + xBytes * rows;
      } else i += 1;
    } else if (b >= 0x20) put(decodeByte(b, codePage));
  }
  flushIfOpen();
  return blocks;
}

// The preview's plain text, line by line (tests, and copying).
export function previewText(blocks: readonly PreviewBlock[]): string {
  return blocks.map((b) => (b.kind === "line" ? b.runs.map((r) => r.text).join("") : b.kind === "image" ? `[image ${b.raster.width}x${b.raster.height}]` : b.kind === "cut" ? "[cut]" : "[drawer]")).join("\n");
}
