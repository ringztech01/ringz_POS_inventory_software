import type { OrderStatus, ReservationStatus } from "@prisma/client";

// THE table-status rule. Every screen gets a table's status from here; it is
// never stored and never worked out anywhere else.
//
//   Occupied   it has an Open, Sent or Served order
//   Cleaning   its last order was billed and cleaning is manual (needsCleaning)
//   Reserved   a Booked reservation is due: from `reservedWindowMinutes`
//              before its time until RESERVATION_GRACE_MINUTES after
//   Available  otherwise
//
// In that order of precedence: a dirty table shows Cleaning even with a
// booking due, since it has to be cleaned before anyone sits there.

export type TableStatus = "Available" | "Occupied" | "Reserved" | "Cleaning";

export const TABLE_STATUSES: readonly TableStatus[] = ["Available", "Occupied", "Reserved", "Cleaning"];

// Orders in these statuses hold their table (Order.activeTableId agrees).
export const TABLE_HOLDING_STATUSES: readonly OrderStatus[] = ["OPEN", "SENT", "SERVED"];

// A late Booked party keeps its table this long; after that the booking is
// flagged as late (a likely no-show) and no longer holds the table.
export const RESERVATION_GRACE_MINUTES = 30;

export type TableStatusRules = {
  // BusinessSetting.restaurantReservedWindowMinutes.
  reservedWindowMinutes: number;
  // BusinessSetting.restaurantManualCleaning.
  manualCleaning: boolean;
};

type OrderLike = { status: OrderStatus; deletedAt: Date | null };
type ReservationLike = { status: ReservationStatus; startsAt: Date; deletedAt: Date | null };

export type TableStatusInput<O extends OrderLike, R extends ReservationLike> = {
  deletedAt: Date | null;
  needsCleaning: boolean;
  // Candidates; this picks the one holding the table (there's at most one).
  orders: readonly O[];
  // Candidates; this picks the earliest Booked one that's due.
  reservations: readonly R[];
};

export type TableState<O, R> = {
  status: TableStatus;
  // The order holding the table (Occupied).
  order: O | null;
  // The booking that's due, whatever the status — so an Occupied or
  // Cleaning table can still show "booked for 19:30".
  reservation: R | null;
};

const MINUTE = 60_000;

// startsAt range of the bookings that make a table Reserved at `now`. Queries
// use it to load only those; tableStatus applies the same range.
export function reservationHoldRange(now: Date, rules: TableStatusRules): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - RESERVATION_GRACE_MINUTES * MINUTE),
    to: new Date(now.getTime() + rules.reservedWindowMinutes * MINUTE),
  };
}

// null for a soft-deleted table: it has no status because it isn't on the
// floor (callers leave deleted tables out anyway).
export function tableStatus<O extends OrderLike, R extends ReservationLike>(
  table: TableStatusInput<O, R>,
  rules: TableStatusRules,
  now: Date,
): TableState<O, R> | null {
  if (table.deletedAt) return null;

  const order = table.orders.find((o) => !o.deletedAt && TABLE_HOLDING_STATUSES.includes(o.status)) ?? null;
  const { from, to } = reservationHoldRange(now, rules);
  const reservation =
    table.reservations
      .filter((r) => !r.deletedAt && r.status === "BOOKED" && r.startsAt >= from && r.startsAt <= to)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;

  if (order) return { status: "Occupied", order, reservation };
  if (table.needsCleaning && rules.manualCleaning) return { status: "Cleaning", order: null, reservation };
  if (reservation) return { status: "Reserved", order: null, reservation };
  return { status: "Available", order: null, reservation: null };
}
