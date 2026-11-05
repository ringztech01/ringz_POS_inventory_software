import { connect, isIP, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { MODEL_QUERY, readModel, readStatus, STATUS_PAPER, STATUS_PRINTER } from "./escposStatus.ts";
import { run } from "./run.ts";
import { HR_DEVICE_DESCR, snmpGet, SYS_DESCR } from "./snmp.ts";
import type { DiscoveredPrinter } from "./types.ts";

// LAN printers that take raw jobs on TCP 9100.
//   scan   every host in this machine's /24 subnet(s): is 9100 open? Only a
//          TCP connect — no bytes go to the port (an office printer on 9100
//          prints whatever it's sent). The model comes from SNMP (read-only),
//          the MAC from the ARP table (Step 7 matches a printer whose IP
//          changed by it).
//   probe  one host the user picked or typed (the manual IP fallback): the
//          same, plus ESC/POS real-time status (offline, paper out) and model.

export const RAW_PORT = 9100;

export type Subnet = { cidr: string; hosts: string[] };

// This machine's IPv4 LANs as /24s (a wider LAN is scanned only around this
// machine's own address, to stay quick). Loopback and link-local skipped.
export function subnetsFrom(interfaces: ReturnType<typeof networkInterfaces>): Subnet[] {
  const seen = new Map<string, Subnet>();
  for (const list of Object.values(interfaces)) {
    for (const nic of list ?? []) {
      if (nic.family !== "IPv4" || nic.internal || nic.address.startsWith("169.254.")) continue;
      const [a, b, c, own] = nic.address.split(".").map(Number);
      const cidr = `${a}.${b}.${c}.0/24`;
      if (seen.has(cidr)) continue;
      const hosts: string[] = [];
      for (let d = 1; d <= 254; d++) if (d !== own) hosts.push(`${a}.${b}.${c}.${d}`);
      seen.set(cidr, { cidr, hosts });
    }
  }
  return [...seen.values()];
}

// "192.168.1.50   00-11-22-aa-bb-cc   dynamic" (Windows arp -a) or
// "192.168.1.50 dev eth0 lladdr 00:11:22:aa:bb:cc REACHABLE" (ip neigh) →
// "00:11:22:AA:BB:CC".
export function macFromArp(output: string, ip: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (!cols.includes(ip)) continue;
    const mac = cols.find((col) => /^([0-9a-f]{2}[-:]){5}[0-9a-f]{2}$/i.test(col));
    if (mac && !/^(ff[-:]){5}ff$/i.test(mac) && !/^(00[-:]){5}00$/.test(mac)) return mac.replace(/-/g, ":").toUpperCase();
  }
  return null;
}

async function arpTable(): Promise<string> {
  try {
    return process.platform === "win32" ? await run("arp", ["-a"], 5000) : await run("ip", ["neigh"], 5000).catch(() => run("arp", ["-an"], 5000));
  } catch {
    return "";
  }
}

// Is the port open? A bare connect, closed at once.
export function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function snmpModel(host: string): Promise<string | null> {
  const [device, system] = await Promise.all([snmpGet(host, HR_DEVICE_DESCR), snmpGet(host, SYS_DESCR)]);
  return device ?? system;
}

function networkPrinter(host: string, port: number, model: string | null, mac: string | null): DiscoveredPrinter {
  return {
    id: `net:${host}:${port}`,
    name: model ? `${model} (${host})` : `Network printer ${host}`,
    connection: "NETWORK",
    address: `${host}:${port}`,
    model,
    status: "ONLINE",
    statusDetail: "Answering on port 9100",
    identity: mac ? { mac } : {},
  };
}

export async function scanNetwork(options: { timeoutMs?: number; concurrency?: number } = {}): Promise<{ printers: DiscoveredPrinter[]; subnets: string[] }> {
  const subnets = subnetsFrom(networkInterfaces());
  const hosts = subnets.flatMap((s) => s.hosts);
  const open = await mapLimit(hosts, options.concurrency ?? 64, (host) => portOpen(host, RAW_PORT, options.timeoutMs ?? 400));
  const found = hosts.filter((_, i) => open[i]);
  const arp = found.length ? await arpTable() : "";
  const printers = await mapLimit(found, 8, async (host) => networkPrinter(host, RAW_PORT, await snmpModel(host), macFromArp(arp, host)));
  return { printers, subnets: subnets.map((s) => s.cidr) };
}

// Sends `bytes` and collects what comes back for `waitMs`.
function ask(socket: Socket, bytes: Uint8Array, waitMs: number): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => chunks.push(chunk);
    socket.on("data", onData);
    socket.write(bytes);
    setTimeout(() => {
      socket.off("data", onData);
      resolve(new Uint8Array(Buffer.concat(chunks)));
    }, waitMs);
  });
}

// "192.168.1.50", "192.168.1.50:9100" or a hostname → host and port.
export function parseTarget(target: string): { host: string; port: number } | null {
  const trimmed = target.trim();
  const match = /^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : RAW_PORT;
  if (port < 1 || port > 65535) return null;
  if (!isIP(match[1]) && !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(match[1])) return null;
  return { host: match[1], port };
}

// One printer, on request: reachable? Then its ESC/POS status and model
// (non-printing commands), SNMP model and MAC.
export async function probePrinter(host: string, port = RAW_PORT, timeoutMs = 1500): Promise<DiscoveredPrinter> {
  const socket = await new Promise<Socket | null>((resolve) => {
    const s = connect({ host, port });
    s.setTimeout(timeoutMs, () => {
      s.destroy();
      resolve(null);
    });
    s.once("connect", () => {
      s.setTimeout(0);
      resolve(s);
    });
    s.once("error", () => resolve(null));
  });
  const [model, arp] = await Promise.all([snmpModel(host), arpTable()]);
  const mac = macFromArp(arp, host);
  if (!socket) {
    return { ...networkPrinter(host, port, model, mac), status: "OFFLINE", statusDetail: `No answer on port ${port}` };
  }
  try {
    const printerReply = await ask(socket, STATUS_PRINTER, 400);
    const paperReply = await ask(socket, STATUS_PAPER, 400);
    const modelReply = await ask(socket, MODEL_QUERY, 400);
    const { status, detail } = readStatus(printerReply[0] ?? null, paperReply[0] ?? null);
    const escposModel = readModel(modelReply);
    return { ...networkPrinter(host, port, escposModel ?? model, mac), status: status === "UNKNOWN" ? "ONLINE" : status, statusDetail: detail ?? "Ready" };
  } finally {
    socket.destroy();
  }
}
