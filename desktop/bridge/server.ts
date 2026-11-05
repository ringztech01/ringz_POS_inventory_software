import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MIN_SECRET_LENGTH, refusal } from "./auth.ts";
import { discover } from "./discover.ts";
import { parseTarget, probePrinter } from "./discoverNetwork.ts";
import { printRaw } from "./print.ts";
import { statuses, type SavedPrinter } from "./status.ts";
import type { PrinterConnection } from "./types.ts";

// The hardware bridge: a small HTTP service on this machine for the app
// server only (127.0.0.1 + BRIDGE_SECRET — auth.ts). Started by the app
// server (instrumentation.ts → lib/hardware/bridgeLauncher.ts) and run by Node
// directly (type stripping). Clients never reach it: their print jobs go to
// the app server, which calls this.
//
//   GET  /health                       { ok, version, platform, pid, uptimeSec }
//   GET  /discover[?network=0&timeout=400]   DiscoveryResult (types.ts)
//   POST /probe  { "target": "192.168.1.50[:9100]" }   { ok, printer }
//   POST /print  { connection, address, baudRate?, data: base64 }   { ok, bytes }
//   POST /status { printers: [{ id, connection, address }] }   { ok, statuses }

export const BRIDGE_VERSION = 1;
const DEFAULT_PORT = 9137;

const secret = process.env.BRIDGE_SECRET ?? "";
const port = Number(process.env.BRIDGE_PORT) || DEFAULT_PORT;

if (secret.length < MIN_SECRET_LENGTH) {
  console.error(`BRIDGE_SECRET must be set (at least ${MIN_SECRET_LENGTH} characters) — not starting.`);
  process.exit(78);
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

const CONNECTIONS: readonly PrinterConnection[] = ["OS", "USB", "NETWORK", "SERIAL"];
const isConnection = (value: unknown): value is PrinterConnection => typeof value === "string" && (CONNECTIONS as readonly string[]).includes(value);

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Request too large.");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = createServer(async (req, res) => {
  const denied = refusal(req.socket.remoteAddress, req.headers["x-bridge-secret"], secret);
  if (denied) return send(res, denied.status, { ok: false, error: denied.error });
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, version: BRIDGE_VERSION, platform: process.platform, pid: process.pid, uptimeSec: Math.round(process.uptime()) });
    }
    if (req.method === "GET" && url.pathname === "/discover") {
      const timeout = Number(url.searchParams.get("timeout"));
      const result = await discover({ network: url.searchParams.get("network") !== "0", timeoutMs: timeout >= 100 && timeout <= 3000 ? timeout : undefined });
      return send(res, 200, { ok: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/probe") {
      const body = (await readJson(req)) as { target?: unknown };
      const target = typeof body.target === "string" ? parseTarget(body.target) : null;
      if (!target) return send(res, 400, { ok: false, error: "Enter an IP address or host name, like 192.168.1.50 or 192.168.1.50:9100." });
      return send(res, 200, { ok: true, printer: await probePrinter(target.host, target.port) });
    }
    if (req.method === "POST" && url.pathname === "/print") {
      const body = (await readJson(req, 4 * 1024 * 1024)) as { connection?: unknown; address?: unknown; baudRate?: unknown; data?: unknown };
      if (!isConnection(body.connection) || typeof body.address !== "string" || !body.address || typeof body.data !== "string") {
        return send(res, 400, { ok: false, error: "Send connection, address and data (base64)." });
      }
      const data = new Uint8Array(Buffer.from(body.data, "base64"));
      try {
        await printRaw({ connection: body.connection, address: body.address, baudRate: typeof body.baudRate === "number" ? body.baudRate : undefined }, data);
      } catch (error) {
        return send(res, 502, { ok: false, error: (error as Error).message });
      }
      return send(res, 200, { ok: true, bytes: data.length });
    }
    if (req.method === "POST" && url.pathname === "/status") {
      const body = (await readJson(req)) as { printers?: unknown };
      const list = Array.isArray(body.printers) ? body.printers : [];
      const saved = list.filter(
        (p): p is SavedPrinter => typeof p === "object" && p !== null && typeof (p as SavedPrinter).id === "string" && isConnection((p as SavedPrinter).connection) && typeof (p as SavedPrinter).address === "string",
      );
      return send(res, 200, { ok: true, statuses: await statuses(saved.slice(0, 50)) });
    }
    return send(res, 404, { ok: false, error: "Not found." });
  } catch (error) {
    return send(res, 500, { ok: false, error: (error as Error).message });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use — is another bridge running?` : error.message);
  process.exit(error.code === "EADDRINUSE" ? 75 : 1);
});

// Loopback only: nothing on the LAN can even connect.
server.listen(port, "127.0.0.1", () => console.log(`Hardware bridge listening on 127.0.0.1:${port} (pid ${process.pid})`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
// Stop with the app server: the launcher's pipe closing means it's gone.
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
