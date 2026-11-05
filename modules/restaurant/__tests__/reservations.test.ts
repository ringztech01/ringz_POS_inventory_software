// Run with: npx tsx --test modules/restaurant/__tests__/reservations.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ReservationStatus } from "@prisma/client";
import { bookingClash, isLate } from "../lib/reservations";
import { appDateTime, appDayBounds, dayLabel, formatAppTime, formatMinutes, isCalendarDay } from "../lib/time";
import { reservationSchema } from "../schemas/reservation";

const at = (time: string) => appDateTime("2026-10-29", time);
const booked = (time: string, status: ReservationStatus = "BOOKED") => ({ status, startsAt: at(time), time });

describe("double-booking window (±gap)", () => {
  const existing = [booked("19:30")];

  test("inside the window clashes, either side", () => {
    assert.equal(bookingClash(existing, at("19:30"), 120)?.time, "19:30");
    assert.equal(bookingClash(existing, at("17:31"), 120)?.time, "19:30");
    assert.equal(bookingClash(existing, at("21:29"), 120)?.time, "19:30");
  });

  test("exactly the gap apart, or further, is fine", () => {
    assert.equal(bookingClash(existing, at("17:30"), 120), null);
    assert.equal(bookingClash(existing, at("21:30"), 120), null);
    assert.equal(bookingClash(existing, at("23:00"), 120), null);
  });

  test("the window is the setting", () => {
    assert.equal(bookingClash(existing, at("20:30"), 60), null);
    assert.equal(bookingClash(existing, at("20:29"), 60)?.time, "19:30");
  });

  test("only Booked reservations count", () => {
    for (const status of ["SEATED", "CANCELLED", "NO_SHOW"] as const) {
      assert.equal(bookingClash([booked("19:30", status)], at("19:30"), 120), null, status);
    }
  });

  test("the nearest clash is the one reported", () => {
    assert.equal(bookingClash([booked("18:00"), booked("19:45"), booked("20:30")], at("19:30"), 120)?.time, "19:45");
  });
});

test("late: Booked and more than 30 minutes past its time", () => {
  const b = booked("19:00");
  assert.equal(isLate(b, at("19:30")), false);
  assert.equal(isLate(b, at("19:31")), true);
  assert.equal(isLate({ ...b, status: "SEATED" }, at("21:00")), false);
});

describe("app clock (Africa/Lagos, UTC+1)", () => {
  test("a typed day and time is that instant in Lagos", () => {
    assert.equal(appDateTime("2026-10-29", "19:30").toISOString(), "2026-10-29T18:30:00.000Z");
    assert.equal(formatAppTime(new Date("2026-10-29T18:30:00.000Z")), "19:30");
    assert.equal(formatAppTime(new Date("2026-10-29T23:15:00.000Z")), "00:15");
  });

  test("a day's bounds are Lagos midnight to midnight", () => {
    const { start, end } = appDayBounds("2026-10-29");
    assert.deepEqual([start.toISOString(), end.toISOString()], ["2026-10-28T23:00:00.000Z", "2026-10-29T23:00:00.000Z"]);
  });

  test("labels and checks", () => {
    assert.deepEqual(
      ["2026-10-29", "2026-10-30", "2026-10-28", "2026-11-05"].map((d) => dayLabel(d, "2026-10-29")),
      ["Today", "Tomorrow", "Yesterday", "Thu 5 Nov"],
    );
    assert.deepEqual(["2026-02-28", "2026-02-30", "29-10-2026", 20261029].map(isCalendarDay), [true, false, false, false]);
    assert.deepEqual([120, 60, 90].map(formatMinutes), ["2 hours", "1 hour", "90 minutes"]);
  });
});

describe("booking form", () => {
  const base = { partySize: 4, date: "2026-10-30", time: "19:30", tableId: "t1" };
  const issues = (input: unknown) => {
    const r = reservationSchema.safeParse(input);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  test("a typed guest needs a name and a valid phone", () => {
    assert.deepEqual(issues(base), ["guestName: Enter the guest's name, or pick a customer.", "guestPhone: Enter a phone number."]);
    assert.deepEqual(issues({ ...base, guestName: "Okafor", guestPhone: "12ab" }), ["guestPhone: Enter a valid phone number."]);
    assert.deepEqual(issues({ ...base, guestName: "Okafor", guestPhone: "0812 554 0192" }), []);
  });

  test("an existing customer needs neither", () => {
    assert.deepEqual(issues({ ...base, customerId: "c1" }), []);
  });

  test("guest errors are reported alongside the other fields' errors", () => {
    assert.deepEqual(issues({ partySize: "", date: "2026-10-30", time: "", tableId: "" }), [
      "partySize: Party size must be a whole number from 1 to 30.",
      "time: Pick a time.",
      "tableId: Choose a table.",
      "guestName: Enter the guest's name, or pick a customer.",
      "guestPhone: Enter a phone number.",
    ]);
  });

  test("party size, date, time and table", () => {
    assert.deepEqual(issues({ customerId: "c1", partySize: 0, date: "2026-02-30", time: "25:00", tableId: "" }), [
      "partySize: Party size must be a whole number from 1 to 30.",
      "date: Pick a date.",
      "time: Pick a time.",
      "tableId: Choose a table.",
    ]);
  });
});
