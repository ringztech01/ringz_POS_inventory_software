// The app's own name on the restaurant's Wi-Fi (6g follow-up 5): phones and
// tablets that ask "where is ringzpos.local?" (multicast DNS, RFC 6762) get
// this PC's address, so the QR codes keep working when its IP changes.
// Pure: reading a question and writing the answer. The socket that listens
// is lib/hardware/mdnsResponder.ts.

export const APP_MDNS_NAME = "ringzpos.local";
export const MDNS_GROUP = "224.0.0.251";
export const MDNS_PORT = 5353;

const TYPE_A = 1;
const TYPE_ANY = 255;
const CLASS_IN = 1;

export type MdnsQuestion = { name: string; type: number; unicast: boolean };
export type MdnsQuery = { id: number; questions: MdnsQuestion[] };

// A name at `offset`, following compression pointers (at most 20, so a bad
// packet can't loop). Null: it runs off the end or is malformed.
function readName(buf: Buffer, offset: number): { name: string; next: number } | null {
  const labels: string[] = [];
  let at = offset;
  let next = -1;
  for (let jumps = 0; jumps < 20; ) {
    if (at >= buf.length) return null;
    const len = buf[at];
    if (len === 0) {
      if (next < 0) next = at + 1;
      return { name: labels.join("."), next };
    }
    if ((len & 0xc0) === 0xc0) {
      if (at + 1 >= buf.length) return null;
      if (next < 0) next = at + 2;
      at = ((len & 0x3f) << 8) | buf[at + 1];
      jumps++;
      continue;
    }
    if (len > 63 || at + 1 + len > buf.length) return null;
    labels.push(buf.toString("latin1", at + 1, at + 1 + len));
    at += 1 + len;
  }
  return null;
}

// A query's id and questions; null for an answer, or anything unreadable.
export function parseQuery(buf: Buffer): MdnsQuery | null {
  if (buf.length < 12) return null;
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return null;
  const count = buf.readUInt16BE(4);
  const questions: MdnsQuestion[] = [];
  let at = 12;
  for (let i = 0; i < count && i < 32; i++) {
    const read = readName(buf, at);
    if (!read || read.next + 4 > buf.length) return null;
    const type = buf.readUInt16BE(read.next);
    const klass = buf.readUInt16BE(read.next + 2);
    questions.push({ name: read.name.toLowerCase(), type, unicast: (klass & 0x8000) !== 0 && (klass & 0x7fff) === CLASS_IN });
    at = read.next + 4;
  }
  return { id: buf.readUInt16BE(0), questions };
}

// Whether a question asks for this name's IPv4 address.
export const asksFor = (q: MdnsQuestion, name: string) => q.name === name.toLowerCase() && (q.type === TYPE_A || q.type === TYPE_ANY);

function encodeName(name: string): Buffer {
  const parts = name.split(".").filter(Boolean);
  const out: Buffer[] = [];
  for (const label of parts) {
    const bytes = Buffer.from(label, "latin1");
    if (bytes.length > 63) throw new Error("A DNS label is at most 63 characters.");
    out.push(Buffer.from([bytes.length]), bytes);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function ipBytes(ip: string): Buffer {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`Not an IPv4 address: ${ip}`);
  return Buffer.from(parts);
}

// The answer: `name` is at `ip`. Multicast (the usual): id 0, no question,
// the cache-flush bit, two minutes. `legacy`: a plain DNS client asked from
// another port — its id and question back, no cache-flush, ten seconds
// (RFC 6762 §6.7).
export function answerA(name: string, ip: string, opts: { legacy?: { id: number } } = {}): Buffer {
  const encoded = encodeName(name);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(opts.legacy?.id ?? 0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(opts.legacy ? 1 : 0, 4);
  header.writeUInt16BE(1, 6);
  const question = opts.legacy ? Buffer.concat([encoded, Buffer.from([0, TYPE_A, 0, CLASS_IN])]) : Buffer.alloc(0);
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(TYPE_A, 0);
  fixed.writeUInt16BE(opts.legacy ? CLASS_IN : 0x8000 | CLASS_IN, 2);
  fixed.writeUInt32BE(opts.legacy ? 10 : 120, 4);
  fixed.writeUInt16BE(4, 8);
  return Buffer.concat([header, question, encoded, fixed, ipBytes(ip)]);
}

// Which of this PC's addresses to give someone who asked from `from`: the
// one on the same network (by its netmask), else the first.
export function addressFor(from: string, mine: readonly { address: string; netmask: string }[]): string | null {
  const num = (ip: string) => ip.split(".").reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
  const same = mine.find((m) => (num(m.address) & num(m.netmask)) >>> 0 === (num(from) & num(m.netmask)) >>> 0);
  return (same ?? mine[0])?.address ?? null;
}
