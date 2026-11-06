import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DiscoveredPrinter, PrinterIdentity } from "@/desktop/bridge/types.ts";
import { discoverPrinters } from "./bridgeClient";
import { findAgain, suggestNewAddress, type Found, type SavedForMatch } from "./reconnect";

// Plug and play (Step 7; the rules are reconnect.ts). No "server-only": the
// print worker runs it.
//
//   redetectLocal     an OS / USB printer that's gone offline is looked for
//                     among this computer's printers (no LAN scan) and, when
//                     found again, its address is updated — same printer row,
//                     so its assignments, fallbacks and queued jobs carry on.
//                     At most once per REDETECT_MS (a PowerShell / lpstat
//                     call); the worker and Settings › Printers both use it.
//   suggestMoved      a network printer that doesn't answer: a LAN scan for
//                     the same MAC (or model) — a suggestion the admin
//                     accepts on Settings › Printers.

const REDETECT_MS = 30_000;
type Discover = () => Promise<{ ok: true; printers: DiscoveredPrinter[] } | { ok: false; error: string }>;
const localDiscovery: Discover = async () => {
  const r = await discoverPrinters({ network: false });
  return r.ok ? { ok: true, printers: r.data.printers } : { ok: false, error: r.error };
};
const lanDiscovery: Discover = async () => {
  const r = await discoverPrinters({ network: true });
  return r.ok ? { ok: true, printers: r.data.printers } : { ok: false, error: r.error };
};

const g = globalThis as typeof globalThis & { __ringzRedetectAt?: number };

const asSaved = (p: { id: string; connection: string; address: string; model: string | null; identity: Prisma.JsonValue }): SavedForMatch => ({
  id: p.id,
  connection: p.connection,
  address: p.address,
  model: p.model,
  identity: p.identity && typeof p.identity === "object" && !Array.isArray(p.identity) ? (p.identity as PrinterIdentity) : null,
});

export type Redetected = { printerId: string; name: string; from: string; to: string; by: Found["by"] };

// The offline local printers among `offlineIds`, found again: their new
// addresses saved. `force` skips the once-per-30s limit (tests, Settings).
export async function redetectLocal(offlineIds: readonly string[], options: { force?: boolean; discover?: Discover } = {}): Promise<Redetected[]> {
  if (offlineIds.length === 0) return [];
  const now = Date.now();
  if (!options.force && g.__ringzRedetectAt && now - g.__ringzRedetectAt < REDETECT_MS) return [];
  g.__ringzRedetectAt = now;
  const all = (await prisma.printer.findMany({ where: { deletedAt: null }, select: { id: true, name: true, connection: true, address: true, model: true, identity: true } })).map((p) => ({ ...asSaved(p), name: p.name }));
  const lost = all.filter((p) => offlineIds.includes(p.id) && (p.connection === "OS" || p.connection === "USB"));
  if (lost.length === 0) return [];
  const seen = await (options.discover ?? localDiscovery)();
  if (!seen.ok) return [];
  const moved: Redetected[] = [];
  const movedTo = new Map<string, string>();
  for (const printer of lost) {
    // Matched against the addresses as they are now (an earlier move counts).
    const current = all.map((p) => (movedTo.has(p.id) ? { ...p, address: movedTo.get(p.id)! } : p));
    const found = findAgain(printer, seen.printers, current);
    if (!found) continue;
    const updated = await prisma.$transaction((tx) =>
      tx.printer.updateMany({
        where: { id: printer.id, deletedAt: null, address: printer.address },
        data: { address: found.address, identity: found.identity as Prisma.InputJsonValue, lastStatus: null },
      }),
    );
    if (updated.count) {
      movedTo.set(printer.id, found.address);
      moved.push({ printerId: printer.id, name: printer.name, from: printer.address, to: found.address, by: found.by });
      console.log(`[print] ${printer.name} was found again at ${found.address} (by ${found.by}) — same printer, same assignments.`);
    }
  }
  return moved;
}

export type MoveSuggestion = { address: string; by: "mac" | "model"; model: string | null };

// A network printer's new address from a LAN scan, or why there's none.
export async function suggestMoved(printerId: string, options: { discover?: Discover } = {}): Promise<{ ok: true; suggestion: MoveSuggestion | null } | { ok: false; error: string }> {
  const all = (await prisma.printer.findMany({ where: { deletedAt: null }, select: { id: true, connection: true, address: true, model: true, identity: true } })).map(asSaved);
  const printer = all.find((p) => p.id === printerId);
  if (!printer || printer.connection !== "NETWORK") return { ok: false, error: "That isn't a network printer." };
  const scanned = await (options.discover ?? lanDiscovery)();
  if (!scanned.ok) return { ok: false, error: scanned.error };
  const found = suggestNewAddress(printer, scanned.printers, all);
  return { ok: true, suggestion: found ? { address: found.address, by: found.by === "mac" ? "mac" : "model", model: found.model } : null };
}
