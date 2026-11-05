import type { PrinterStatus } from "./types.ts";

// ESC/POS real-time status (DLE EOT n) — the bytes and how to read the
// replies. Nothing here prints: DLE EOT is answered at once and never goes
// onto paper. Only sent to a printer the user has picked (a probe), never
// to every port 9100 on the LAN — an office laser printer on 9100 would
// print the bytes.

const DLE = 0x10;
const EOT = 0x04;

// n = 1 printer status, n = 4 paper roll sensor.
export const STATUS_PRINTER = Uint8Array.from([DLE, EOT, 1]);
export const STATUS_PAPER = Uint8Array.from([DLE, EOT, 4]);

// GS I 67: the model name, on printers that support it (Epson and most
// clones): "_" + text + NUL.
export const MODEL_QUERY = Uint8Array.from([0x1d, 0x49, 0x43]);

// A real-time status byte always has bit 1 and bit 4 set, bits 0 and 7 clear.
export function isStatusByte(byte: number): boolean {
  return (byte & 0x93) === 0x12;
}

// The printer's state from its DLE EOT 1 and DLE EOT 4 replies (either may
// be missing): offline is bit 3 of n=1; paper end is bits 5–6 of n=4.
export function readStatus(printerByte: number | null, paperByte: number | null): { status: PrinterStatus; detail: string | null } {
  const printer = printerByte !== null && isStatusByte(printerByte) ? printerByte : null;
  const paper = paperByte !== null && isStatusByte(paperByte) ? paperByte : null;
  if (printer === null && paper === null) return { status: "UNKNOWN", detail: "No status reply" };
  if (paper !== null && (paper & 0x60) !== 0) return { status: "PAPER_OUT", detail: "Paper out" };
  if (printer !== null && (printer & 0x08) !== 0) return { status: "OFFLINE", detail: "Printer reports offline (cover open or error)" };
  if (paper !== null && (paper & 0x0c) !== 0) return { status: "ONLINE", detail: "Paper low" };
  return { status: "ONLINE", detail: null };
}

// The GS I 67 reply ("_TM-T20II\0") → "TM-T20II"; null if it isn't one.
export function readModel(reply: Uint8Array): string | null {
  if (reply.length < 3 || reply[0] !== 0x5f) return null;
  const end = reply.indexOf(0, 1);
  const text = Buffer.from(reply.subarray(1, end === -1 ? reply.length : end)).toString("latin1").trim();
  return /^[\x20-\x7e]{1,64}$/.test(text) ? text : null;
}
