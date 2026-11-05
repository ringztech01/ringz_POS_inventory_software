// Run with: npx tsx --test modules/restaurant/__tests__/tableStatus.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus, ReservationStatus } from "@prisma/client";
import { RESERVATION_GRACE_MINUTES, reservationHoldRange, tableStatus, type TableStatusRules } from "../lib/tableStatus";

const NOW = new Date("2026-10-29T18:30:00Z");
const RULES: TableStatusRules = { reservedWindowMinutes: 60, manualCleaning: true };
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000);

type Order = { id: string; status: OrderStatus; deletedAt: Date | null };
type Booking = { id: string; status: ReservationStatus; startsAt: Date; deletedAt: Date | null };
const order = (status: OrderStatus, deletedAt: Date | null = null): Order => ({ id: `o-${status}`, status, deletedAt });
const booking = (minutesFromNow: number, status: ReservationStatus = "BOOKED", deletedAt: Date | null = null): Booking => ({
  id: `r${minutesFromNow}`,
  status,
  startsAt: at(minutesFromNow),
  deletedAt,
});
const table = (extra: Partial<{ orders: Order[]; reservations: Booking[]; needsCleaning: boolean; deletedAt: Date | null }> = {}) => ({
  deletedAt: null,
  needsCleaning: false,
  orders: [],
  reservations: [],
  ...extra,
});
const status = (input: ReturnType<typeof table>, rules = RULES) => tableStatus(input, rules, NOW)?.status ?? null;

describe("the four statuses", () => {
  test("Available: nothing on it", () => {
    assert.equal(status(table()), "Available");
  });

  test("Occupied: an Open, Sent or Served order", () => {
    for (const s of ["OPEN", "SENT", "SERVED"] as const) assert.equal(status(table({ orders: [order(s)] })), "Occupied");
    const state = tableStatus(table({ orders: [order("SENT")] }), RULES, NOW);
    assert.equal(state?.order?.id, "o-SENT");
  });

  test("Reserved: a Booked reservation within the next 60 minutes", () => {
    assert.equal(status(table({ reservations: [booking(45)] })), "Reserved");
    assert.equal(status(table({ reservations: [booking(60)] })), "Reserved");
    assert.equal(status(table({ reservations: [booking(61)] })), "Available");
  });

  test("Cleaning: billed with manual cleaning", () => {
    assert.equal(status(table({ needsCleaning: true })), "Cleaning");
    // Cleaning set to automatic: the flag is ignored.
    assert.equal(status(table({ needsCleaning: true }), { ...RULES, manualCleaning: false }), "Available");
  });
});

describe("edge cases", () => {
  test("a billed or cancelled order doesn't occupy the table", () => {
    assert.equal(status(table({ orders: [order("BILLED")] })), "Available");
    assert.equal(status(table({ orders: [order("CANCELLED")] })), "Available");
    assert.equal(status(table({ orders: [order("BILLED")], needsCleaning: true })), "Cleaning");
  });

  test("a soft-deleted order doesn't occupy the table", () => {
    assert.equal(status(table({ orders: [order("OPEN", at(-5))] })), "Available");
  });

  test("an expired booking (more than 30 minutes late) no longer holds the table", () => {
    assert.equal(status(table({ reservations: [booking(-RESERVATION_GRACE_MINUTES)] })), "Reserved");
    assert.equal(status(table({ reservations: [booking(-RESERVATION_GRACE_MINUTES - 1)] })), "Available");
  });

  test("only Booked, non-deleted reservations count", () => {
    for (const s of ["SEATED", "CANCELLED", "NO_SHOW"] as const) assert.equal(status(table({ reservations: [booking(20, s)] })), "Available");
    assert.equal(status(table({ reservations: [booking(20, "BOOKED", at(-1))] })), "Available");
  });

  test("a soft-deleted table has no status", () => {
    assert.equal(tableStatus(table({ deletedAt: at(-10), orders: [order("OPEN")] }), RULES, NOW), null);
  });

  test("precedence: Occupied, then Cleaning, then Reserved — and the due booking is still returned", () => {
    const busy = tableStatus(table({ orders: [order("OPEN")], needsCleaning: true, reservations: [booking(30)] }), RULES, NOW);
    assert.equal(busy?.status, "Occupied");
    assert.equal(busy?.reservation?.id, "r30");
    assert.equal(status(table({ needsCleaning: true, reservations: [booking(30)] })), "Cleaning");
  });

  test("the earliest due booking is the one shown", () => {
    assert.equal(tableStatus(table({ reservations: [booking(50), booking(10), booking(-10)] }), RULES, NOW)?.reservation?.id, "r-10");
  });

  test("the window is the setting", () => {
    assert.equal(status(table({ reservations: [booking(90)] }), { ...RULES, reservedWindowMinutes: 120 }), "Reserved");
    assert.deepEqual(reservationHoldRange(NOW, RULES), { from: at(-30), to: at(60) });
  });
});
