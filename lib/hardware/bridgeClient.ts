import type { DiscoveredPrinter, DiscoveryResult } from "@/desktop/bridge/types.ts";
import { bridgeSecret } from "./bridgeSecret";

// The app server's side of the hardware bridge (desktop/bridge/server.ts):
// every call goes to 127.0.0.1 with the shared secret. Browsers never call
// the bridge — their pages ask the app server, which asks this. No
// server-only marker here, so the print worker (started from
// instrumentation.ts) can use it; app code imports it through ./bridge.

export const BRIDGE_DEFAULT_PORT = 9137;

export type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const BRIDGE_DOWN = "The printer bridge isn't running on the server. Restart the app; if it still isn't, see the server log ([bridge] lines).";

function config(): { url: string; secret: string } | null {
  const secret = bridgeSecret();
  if (!secret) return null;
  return { url: `http://127.0.0.1:${Number(process.env.BRIDGE_PORT) || BRIDGE_DEFAULT_PORT}`, secret };
}

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<BridgeResult<T>> {
  const bridge = config();
  if (!bridge) return { ok: false, error: "Printers are off: there's no NEXTAUTH_SECRET in .env to secure the printer bridge with." };
  try {
    const res = await fetch(`${bridge.url}${path}`, {
      method: init.method ?? "GET",
      headers: { "x-bridge-secret": bridge.secret, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
    if (!json) return { ok: false, error: BRIDGE_DOWN };
    if (!res.ok || json.ok === false) return { ok: false, error: json.error ?? `The bridge answered ${res.status}.` };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: BRIDGE_DOWN };
  }
}

export type BridgeHealth = { version: number; platform: string; pid: number; uptimeSec: number };

export const bridgeHealth = () => call<BridgeHealth>("/health", { timeoutMs: 3000 });

// The LAN scan takes a few seconds; `network: false` for this machine only.
export const discoverPrinters = (options: { network?: boolean } = {}) =>
  call<DiscoveryResult>(`/discover${options.network === false ? "?network=0" : ""}`, { timeoutMs: 60_000 });

// The manual IP fallback: one network printer's status and model.
export const probePrinter = (target: string) => call<{ printer: DiscoveredPrinter }>("/probe", { method: "POST", body: { target }, timeoutMs: 15_000 });

// Raw bytes (ESC/POS) to one printer. The print queue (Step 3) is the only
// caller for real jobs; Settings' Test print until then.
export type RawTarget = { connection: "OS" | "USB" | "NETWORK" | "SERIAL"; address: string; baudRate?: number };
export const printRaw = (target: RawTarget, data: Uint8Array) =>
  call<{ bytes: number }>("/print", { method: "POST", body: { ...target, data: Buffer.from(data).toString("base64") }, timeoutMs: 30_000 });

// The saved printers' state now (id → status).
export type PrinterStatusOf = { status: "ONLINE" | "OFFLINE" | "PAPER_OUT" | "UNKNOWN"; detail: string | null };
export const printerStatuses = (printers: readonly { id: string; connection: RawTarget["connection"]; address: string }[]) =>
  call<{ statuses: Record<string, PrinterStatusOf> }>("/status", { method: "POST", body: { printers }, timeoutMs: 20_000 });
