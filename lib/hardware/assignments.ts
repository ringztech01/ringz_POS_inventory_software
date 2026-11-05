// Which printer does a job — pure, so the rules are tested on their own.
//
//   roles       STATION:<kitchenStationId> (each kitchen station, Bar too —
//               KOTs route by station, Part 4), RECEIPT (the cashier stand,
//               with its drawer), PREBILL (none set: the receipt printer),
//               REPORTS (an OS printer, through the system dialog)
//   a device    may print RECEIPT / PREBILL on its own printer (a device
//               override — "Cashier tablet 2 uses Receipt printer 2"); the
//               role's fallback still applies
//   fallback    used while the main printer is offline (Step 3 reroutes and
//               the ticket says REROUTED FROM <printer>)

export const RECEIPT = "RECEIPT";
export const PREBILL = "PREBILL";
export const REPORTS = "REPORTS";
export const stationRole = (stationId: string) => `STATION:${stationId}`;
export const stationOf = (role: string) => (role.startsWith("STATION:") ? role.slice("STATION:".length) : null);

// Roles a device can override.
export const DEVICE_ROLES = [RECEIPT, PREBILL] as const;

export const MAX_COPIES = 5;

export type Assignment = { role: string; printerId: string; fallbackPrinterId: string | null; copies: number };
export type Resolved = { printerId: string; fallbackPrinterId: string | null; copies: number; via: "device" | "role" | "receipt" };

export function resolvePrinter(
  role: string,
  deviceId: string | null,
  assignments: readonly Assignment[],
  overrides: readonly { deviceId: string; role: string; printerId: string }[],
): Resolved | null {
  const own = assignments.find((a) => a.role === role);
  // A pre-bill with no printer of its own goes to the receipt printer.
  const base = own ?? (role === PREBILL ? assignments.find((a) => a.role === RECEIPT) : undefined);
  const override = deviceId ? overrides.find((o) => o.deviceId === deviceId && o.role === role) : undefined;
  if (override) {
    const fallback = base?.fallbackPrinterId && base.fallbackPrinterId !== override.printerId ? base.fallbackPrinterId : null;
    return { printerId: override.printerId, fallbackPrinterId: fallback, copies: base?.copies ?? 1, via: "device" };
  }
  if (!base) return null;
  return { printerId: base.printerId, fallbackPrinterId: base.fallbackPrinterId, copies: base.copies, via: own ? "role" : "receipt" };
}

// The roles nothing prints to (admins see "No printer assigned for Bar. Set
// up." — Step 7). PREBILL counts as covered by RECEIPT.
export function missingRoles(roles: readonly string[], assignments: readonly Assignment[]): string[] {
  const set = new Set(assignments.map((a) => a.role));
  return roles.filter((role) => !set.has(role) && !(role === PREBILL && set.has(RECEIPT)));
}
