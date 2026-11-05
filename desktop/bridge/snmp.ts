import { createSocket } from "node:dgram";

// A minimal SNMP v1 GET (community "public") — enough to read a network
// printer's description without sending anything to its print port:
//   sysDescr       1.3.6.1.2.1.1.1.0
//   hrDeviceDescr  1.3.6.1.2.1.25.3.2.1.3.1  (the printer's model, usually)
// BER encoding by hand: no SNMP package.

export const SYS_DESCR = "1.3.6.1.2.1.1.1.0";
export const HR_DEVICE_DESCR = "1.3.6.1.2.1.25.3.2.1.3.1";

function length(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}
const tlv = (tag: number, body: number[]): number[] => [tag, ...length(body.length), ...body];
function integer(n: number): number[] {
  const bytes: number[] = [];
  let v = n;
  do {
    bytes.unshift(v & 0xff);
    v >>= 8;
  } while (v > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, bytes);
}
function oid(dotted: string): number[] {
  const arcs = dotted.split(".").map(Number);
  const body = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    for (let v = arc >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    body.push(...chunk);
  }
  return tlv(0x06, body);
}

// The GetRequest message for one OID.
export function encodeGet(dottedOid: string, requestId: number, community = "public"): Uint8Array {
  const varbind = tlv(0x30, [...oid(dottedOid), 0x05, 0x00]);
  const pdu = tlv(0xa0, [...integer(requestId), ...integer(0), ...integer(0), ...tlv(0x30, varbind)]);
  return Uint8Array.from(tlv(0x30, [...integer(0), ...tlv(0x04, [...Buffer.from(community, "latin1")]), ...pdu]));
}

type Node = { tag: number; start: number; end: number };
function read(buf: Uint8Array, at: number): Node | null {
  if (at + 2 > buf.length) return null;
  const tag = buf[at];
  let len = buf[at + 1];
  let start = at + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0 || count > 4 || start + count > buf.length) return null;
    len = 0;
    for (let i = 0; i < count; i++) len = (len << 8) | buf[start + i];
    start += count;
  }
  const end = start + len;
  return end <= buf.length ? { tag, start, end } : null;
}
function children(buf: Uint8Array, node: Node): Node[] {
  const out: Node[] = [];
  for (let at = node.start; at < node.end; ) {
    const child = read(buf, at);
    if (!child) return [];
    out.push(child);
    at = child.end;
  }
  return out;
}
const intOf = (buf: Uint8Array, node: Node) => buf.subarray(node.start, node.end).reduce((n, b) => (n << 8) | b, 0);

// A GetResponse's value as text: the request it answers, no error, an
// OCTET STRING value. Anything else (noSuchName, other types) → null.
export function readGetResponse(buf: Uint8Array, requestId: number): string | null {
  const message = read(buf, 0);
  if (!message || message.tag !== 0x30) return null;
  const pdu = children(buf, message)[2];
  if (!pdu || pdu.tag !== 0xa2) return null;
  const [id, error, , varbinds] = children(buf, pdu);
  if (!id || intOf(buf, id) !== requestId || !error || intOf(buf, error) !== 0 || !varbinds) return null;
  const value = children(buf, children(buf, varbinds)[0] ?? { tag: 0, start: 0, end: 0 })[1];
  if (!value || value.tag !== 0x04) return null;
  const textValue = Buffer.from(buf.subarray(value.start, value.end)).toString("utf8").replace(/\0/g, "").trim();
  return textValue || null;
}

// One GET over UDP 161; null on no answer within the timeout.
export function snmpGet(host: string, dottedOid: string, timeoutMs = 700): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const requestId = Math.floor(Math.random() * 0x7fffffff);
    let finished = false;
    const done = (value: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on("error", () => done(null));
    socket.on("message", (msg) => done(readGetResponse(new Uint8Array(msg), requestId)));
    socket.send(encodeGet(dottedOid, requestId), 161, host, (error) => error && done(null));
  });
}
