// The floor plan editor's words for why something can't happen (Part 7),
// shared by the editor (it checks first, so you're told at once) and the
// save (which checks again, in its transaction).

export const openOrderReason = (table: string) => `Table ${table} has an open order, so it can't be removed. Close or move the order first.`;

export const bookingReason = (table: string, guest: string, time: string) =>
  `Table ${table} has a booking today (${guest} at ${time}), so it can't be removed. Move or cancel the booking first.`;

// "Grace Mensah" → "Grace M."
export function shortName(firstName: string, lastName: string | null | undefined): string {
  const initial = lastName?.trim().charAt(0);
  return initial ? `${firstName.trim()} ${initial.toUpperCase()}.` : firstName.trim();
}

// A save refused because someone else saved the area first.
export const changedBy = (who: string | null, version: number) =>
  who ? `Layout changed by ${who}${who.endsWith(".") ? "" : "."} Reload?` : `Layout changed elsewhere (now v${version}). Reload?`;

// "Saved v13 · 3 tablets updated" once the service screens have drawn it.
export function reachText(saved: string, reach: { showing: number; updated: number } | null): string {
  if (!reach) return `${saved} · updating tablets…`;
  if (reach.showing === 0) return `${saved} · no tablets are showing the floor right now`;
  const tablets = (n: number) => `${n} tablet${n === 1 ? "" : "s"}`;
  if (reach.updated >= reach.showing) return `${saved} · ${tablets(reach.updated)} updated`;
  return `${saved} · ${tablets(reach.updated)} updated, ${reach.showing - reach.updated} still to refresh`;
}
