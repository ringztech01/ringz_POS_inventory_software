import type { TableStatus } from "./tableStatus";
import { staffBadge } from "./posSpeed";

// The tablet's Tables (Part 6g Step 3): each table as a tile. Pure — the
// page passes in the floor the desktop POS uses (server/queries/floor), so
// every state, total and booking is the server's; nothing is worked out
// again here except how it reads.

export type TabletLook = "FREE" | "SEATED" | "SENT" | "BILL" | "LATE" | "RESERVED" | "CLEANING";

type Stage = "SEATED" | "SENT" | "LATE" | "BILL";
export type KitchenState = "NEW" | "PENDING" | "PREPARING" | "READY" | "SERVED";
type LineIn = { id: string; quantity: number; name: string; amount: string; kitchenStatus: KitchenState };
type OrderIn = { id: string; ref: string; check: string | null; stage: Stage; waiterId: string | null; waiterName: string | null; minutes: number; total: string; guests: number; lines?: LineIn[] };
type TableIn = { id: string; name: string; seats: number; status: TableStatus; order: OrderIn | null; checks: OrderIn[]; checksTotal: string; reservation: { id: string; guestName: string; partySize: number; time: string } | null };

// The desktop POS's own rule (PosFloor): an occupied table's look is its
// order's stage.
export function tabletLook(table: { status: TableStatus; order: { stage: Stage } | null }): TabletLook {
  if (table.status === "Occupied" && table.order) return table.order.stage;
  if (table.status === "Reserved") return "RESERVED";
  if (table.status === "Cleaning") return "CLEANING";
  return "FREE";
}

// One check at a table, for the floor's side panel (Step 4): its look, who
// has it and for how long, and its lines with their kitchen state.
export type TabletCheck = {
  id: string;
  label: string;
  total: string;
  guests: number;
  look: TabletLook;
  initials: string | null;
  minutes: number;
  lines: { id: string; quantity: number; name: string; state: string }[];
};
export type TabletTile = {
  id: string;
  name: string;
  look: TabletLook;
  // The waiter's initials ("AO"), and whether it's the person signed in.
  initials: string | null;
  mine: boolean;
  minutes: number | null;
  total: string | null;
  // Free: "Tap to seat"; open: "24 min"; booked: "Okafor · 4".
  info: string;
  // Its open checks (most tables: one).
  checks: TabletCheck[];
  reservation: { id: string; guestName: string; partySize: number; time: string } | null;
  seats: number;
};

export function tabletTile(table: TableIn, userId: string): TabletTile {
  const look = tabletLook(table);
  const order = table.order;
  const busy = !!order && table.status === "Occupied";
  const checks = busy ? (table.checks.length ? table.checks : [order]) : [];
  const info = busy ? `${order.minutes} min` : look === "RESERVED" && table.reservation ? `${table.reservation.guestName} · ${table.reservation.partySize}` : look === "CLEANING" ? "Needs cleaning" : "Tap to seat";
  return {
    id: table.id,
    name: table.name,
    look,
    initials: busy && order.waiterName ? staffBadge(order.waiterName).initials : null,
    mine: busy && checks.some((c) => c.waiterId === userId),
    minutes: busy ? order.minutes : null,
    total: busy ? (checks.length > 1 ? table.checksTotal : order.total) : null,
    info,
    checks: checks.map((c, i) => ({
      id: c.id,
      label: c.check ?? (checks.length > 1 ? `Check ${i + 1}` : c.ref),
      total: c.total,
      guests: c.guests,
      look: c.stage,
      initials: c.waiterName ? staffBadge(c.waiterName).initials : null,
      minutes: c.minutes,
      lines: (c.lines ?? []).map((l) => ({ id: l.id, quantity: l.quantity, name: l.name, state: LINE_STATE[l.kitchenStatus] })),
    })),
    reservation: table.reservation,
    seats: table.seats,
  };
}

// The status line on a tile: the design's words ("Reserved 20:00").
export function lookLabel(tile: Pick<TabletTile, "look" | "reservation">): string {
  switch (tile.look) {
    case "FREE":
      return "Free";
    case "SEATED":
      return "Seated";
    case "SENT":
      return "Food sent";
    case "BILL":
      return "Bill printed";
    case "LATE":
      return "Waiting long";
    case "RESERVED":
      return tile.reservation ? `Reserved ${tile.reservation.time}` : "Reserved";
    case "CLEANING":
      return "Cleaning";
  }
}

// A line's kitchen state on the side panel — the desktop's words.
export const LINE_STATE: Record<KitchenState, string> = { NEW: "NEW", PENDING: "SENT", PREPARING: "PREPARING", READY: "READY", SERVED: "SERVED" };

// A table on the floor, by how wide it shows (px): under 70 its number
// only; from 70 the waiter and minutes too ("AO · 24m"); from 150 the total.
export const FLOOR_DETAIL_PX = 70;
export const FLOOR_TOTAL_PX = 150;
export function floorLabels(tile: Pick<TabletTile, "initials" | "minutes" | "total" | "checks">, widthPx: number): { line1: string | null; line2: string | null; big: boolean } {
  const busy = tile.checks.length > 0;
  const who = busy ? `${tile.initials ?? "—"} · ${tile.minutes ?? 0}m` : null;
  return {
    line1: widthPx >= FLOOR_DETAIL_PX ? who : null,
    line2: widthPx >= FLOOR_TOTAL_PX && busy ? tile.total : null,
    big: widthPx >= FLOOR_DETAIL_PX,
  };
}

// The floor's legend: how many of the area's tables are in each state.
export const FLOOR_LEGEND: TabletLook[] = ["FREE", "SEATED", "SENT", "BILL", "LATE", "RESERVED"];
export function legendCounts(tiles: readonly Pick<TabletTile, "look">[]): Record<TabletLook, number> {
  const out: Record<TabletLook, number> = { FREE: 0, SEATED: 0, SENT: 0, BILL: 0, LATE: 0, RESERVED: 0, CLEANING: 0 };
  for (const t of tiles) out[t.look]++;
  return out;
}

// "Table 5" for a numbered table, the name as it is otherwise ("V1", "Bar 2").
export const tableTitle = (name: string) => (/^\d+$/.test(name) ? `Table ${name}` : name);

// "3 of 12 free".
export const areaFree = (area: { free: number; total: number }) => `${area.free} of ${area.total} free`;

// MY TABLES: everyone else's tables at 25%. Free and booked tables stay as
// they are (anyone may seat them); a manager always sees every table full.
export function dimmed(tile: Pick<TabletTile, "look" | "mine" | "checks">, mineOnly: boolean, manager: boolean): boolean {
  if (!mineOnly || manager) return false;
  return tile.checks.length > 0 && !tile.mine;
}

// A Bartender's Tables with no area of their own: the first area called
// "Bar…" (else whichever the floor opens on).
export function barArea(areas: readonly { id: string; name: string }[]): string | null {
  return areas.find((a) => /\bbar\b/i.test(a.name))?.id ?? null;
}
