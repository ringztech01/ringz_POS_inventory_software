import { discoverLocal } from "./discoverLocal.ts";
import { parseTarget, probePrinter } from "./discoverNetwork.ts";
import type { DiscoveredPrinter, PrinterConnection, PrinterStatus } from "./types.ts";

// The saved printers' state now (Settings › Printers polls it):
//   OS / USB  this machine's list (one PowerShell / lpstat call, kept 5s so a
//             screen polling every few seconds doesn't run it each time) —
//             a queue or device that's gone is Offline
//   NETWORK   a probe of each (ESC/POS real-time status: offline, paper out)
//   SERIAL    Unknown (can't tell without opening the port)

export type SavedPrinter = { id: string; connection: PrinterConnection; address: string };
export type StatusOf = { status: PrinterStatus; detail: string | null };

const LOCAL_TTL_MS = 5000;
let cache: { at: number; printers: Promise<DiscoveredPrinter[]> } | null = null;

function localPrinters(): Promise<DiscoveredPrinter[]> {
  if (!cache || Date.now() - cache.at > LOCAL_TTL_MS) {
    cache = { at: Date.now(), printers: discoverLocal().then((r) => r.printers) };
  }
  return cache.printers;
}

export async function statuses(saved: readonly SavedPrinter[]): Promise<Record<string, StatusOf>> {
  const out: Record<string, StatusOf> = {};
  const needsLocal = saved.some((p) => p.connection === "OS" || p.connection === "USB");
  const local = needsLocal ? await localPrinters().catch(() => null) : [];
  await Promise.all(
    saved.map(async (printer) => {
      if (printer.connection === "SERIAL") {
        out[printer.id] = { status: "UNKNOWN", detail: "Serial ports don't report status" };
      } else if (printer.connection === "NETWORK") {
        const target = parseTarget(printer.address);
        const probe = target ? await probePrinter(target.host, target.port) : null;
        out[printer.id] = probe ? { status: probe.status, detail: probe.statusDetail } : { status: "UNKNOWN", detail: "Not an IP address" };
      } else if (!local) {
        out[printer.id] = { status: "UNKNOWN", detail: "Couldn't list this computer's printers" };
      } else {
        const match =
          printer.connection === "OS"
            ? local.find((p) => p.connection === "OS" && p.name === printer.address)
            : local.find((p) => p.connection === "USB" && p.address === printer.address);
        out[printer.id] = match
          ? { status: match.status, detail: match.statusDetail }
          : { status: "OFFLINE", detail: printer.connection === "OS" ? "No print queue by that name on the server" : "Not connected" };
      }
    }),
  );
  return out;
}
