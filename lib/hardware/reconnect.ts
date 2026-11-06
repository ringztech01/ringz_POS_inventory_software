import type { DiscoveredPrinter, PrinterIdentity } from "@/desktop/bridge/types.ts";

// Plug and play — pure (redetect.ts runs it; tested in hardware.test.ts).
// A saved printer that's gone is looked for again among what the bridge can
// see now, by what identifies it (Printer.identity):
//
//   OS queue   its queue name; Windows re-creates a replugged USB printer as
//              "<name> (Copy 1)" — the same name without that, or the one
//              queue with its driver (model)
//   USB        its vendor + product id and serial; with no serial, the one
//              device with those ids
//   NETWORK    never moved by itself: a scan suggests the new IP — the same
//              MAC address, else the one printer of the same model
//   SERIAL     can't be told apart (ports report nothing)
//
// A candidate another saved printer already uses is never taken, and two
// candidates are no match (it's never a guess).

export type SavedForMatch = { id: string; connection: string; address: string; model: string | null; identity: PrinterIdentity | null };
export type Found = { address: string; identity: PrinterIdentity; model: string | null; by: "name" | "usb" | "model" | "mac" };

const COPY_SUFFIX = /\s*\(copy \d+\)$/i;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const addressOf = (p: DiscoveredPrinter) => (p.connection === "OS" ? p.name : p.address);

// The one candidate, or none.
function only<T>(list: T[]): T | null {
  return list.length === 1 ? list[0] : null;
}

// Addresses the other saved printers use (so no two printers share one).
function taken(saved: SavedForMatch, all: readonly SavedForMatch[]): Set<string> {
  return new Set(all.filter((p) => p.id !== saved.id && p.connection === saved.connection).map((p) => norm(p.address)));
}

// A local (OS / USB) printer that's gone: where it is now, or null.
export function findAgain(saved: SavedForMatch, found: readonly DiscoveredPrinter[], all: readonly SavedForMatch[] = []): Found | null {
  if (saved.connection !== "OS" && saved.connection !== "USB") return null;
  const used = taken(saved, all);
  const pool = found.filter((p) => p.connection === saved.connection && !used.has(norm(addressOf(p))));
  // Still where it was: nothing to do.
  if (pool.some((p) => norm(addressOf(p)) === norm(saved.address))) return null;
  const id = saved.identity ?? {};

  if (saved.connection === "OS") {
    const base = norm((id.osName ?? saved.address).replace(COPY_SUFFIX, ""));
    const byName = only(pool.filter((p) => norm(p.name.replace(COPY_SUFFIX, "")) === base));
    if (byName) return { address: byName.name, identity: { ...id, osName: byName.name }, model: byName.model, by: "name" };
    const byModel = saved.model ? only(pool.filter((p) => norm(p.model) === norm(saved.model))) : null;
    return byModel ? { address: byModel.name, identity: { ...id, osName: byModel.name }, model: byModel.model, by: "model" } : null;
  }

  if (!id.vendorId || !id.productId) return null;
  const sameIds = pool.filter((p) => norm(p.identity.vendorId) === norm(id.vendorId) && norm(p.identity.productId) === norm(id.productId));
  const match = id.serial ? only(sameIds.filter((p) => norm(p.identity.serial) === norm(id.serial))) : only(sameIds.filter((p) => !p.identity.serial));
  return match ? { address: match.address, identity: { ...id, ...match.identity }, model: match.model ?? saved.model, by: "usb" } : null;
}

// A network printer that doesn't answer: the address a LAN scan found it
// at — to suggest, never to switch to by itself.
export function suggestNewAddress(saved: SavedForMatch, scanned: readonly DiscoveredPrinter[], all: readonly SavedForMatch[] = []): Found | null {
  if (saved.connection !== "NETWORK") return null;
  const used = taken(saved, all);
  const host = (address: string) => norm(address.replace(/:\d+$/, ""));
  const pool = scanned.filter((p) => p.connection === "NETWORK" && host(p.address) !== host(saved.address) && !used.has(norm(p.address)) && !used.has(host(p.address)));
  const macOf = (s: string | null | undefined) => norm(s).replace(/-/g, ":");
  const mac = macOf(saved.identity?.mac);
  if (mac) {
    const byMac = only(pool.filter((p) => macOf(p.identity.mac) === mac));
    if (byMac) return { address: byMac.address, identity: { ...saved.identity, ...byMac.identity }, model: byMac.model ?? saved.model, by: "mac" };
  }
  // By model only among printers whose MAC couldn't be read (a different MAC
  // is a different printer, whatever its model).
  const byModel = saved.model ? only(pool.filter((p) => norm(p.model) === norm(saved.model) && (!mac || !macOf(p.identity.mac)))) : null;
  return byModel ? { address: byModel.address, identity: { ...saved.identity, ...byModel.identity }, model: byModel.model, by: "model" } : null;
}

// The roles with no printer, as admins are told — one notice: "No printer
// assigned for Bar. Set up.", "… for Kitchen and Bar. Set up." — only once
// setup has begun (a printer exists).
export function missingMessages(roles: readonly { role: string; label: string }[], assigned: ReadonlySet<string>, printersExist: boolean): string[] {
  if (!printersExist) return [];
  const labels = roles.filter((r) => !assigned.has(r.role)).map((r) => r.label);
  if (labels.length === 0) return [];
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return [`No printer assigned for ${list}. Set up.`];
}
