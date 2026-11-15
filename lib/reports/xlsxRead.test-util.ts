import { inflateRawSync } from "node:zlib";

// Tests only: the files in an .xlsx (a zip), by its central directory —
// which has every entry's sizes even when the entries were streamed with
// data descriptors.
export function unzip(bytes: Buffer): Map<string, string> {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(dataAt, dataAt + packed);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

// A sheet's rows as [ref, style, value] per cell.
export function cells(xml: string): { ref: string; style: string | null; value: string; inline: boolean }[] {
  return [...xml.matchAll(/<c r="([A-Z]+\d+)"(?: t="inlineStr")?(?: s="(\d+)")?(?: t="inlineStr")?>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)].map((m) => ({ ref: m[1], style: m[2] ?? null, value: m[3] ?? m[4] ?? "", inline: m[4] !== undefined }));
}
