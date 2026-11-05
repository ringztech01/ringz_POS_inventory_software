// Run with: npx tsx --test modules/restaurant/__tests__/kds.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtElapsed,
  isLate,
  isTicketDone,
  kotRef,
  modifiersText,
  nextStep,
  previousStep,
  readKdsFilter,
  sentMessage,
  stationFor,
  timesEntering,
  timesSteppingBackTo,
} from "../lib/kds";
import { formatAppDateTime } from "../lib/time";

test("KOT reference: KOT-000123", () => {
  assert.equal(kotRef(123), "KOT-000123");
  assert.equal(kotRef(1), "KOT-000001");
  assert.equal(kotRef(1234567), "KOT-1234567");
});

test("modifiers on a KOT line: names joined with ·, null with none", () => {
  assert.equal(modifiersText([{ id: "m1", group: "Portion", name: "Large", price: "2.00" }, { id: "m2", group: "Extras", name: "Plantain", price: "1.50" }]), "Large · Plantain");
  assert.equal(modifiersText([]), null);
  assert.equal(modifiersText(null), null);
  assert.equal(modifiersText("not json"), null);
});

test("station: the dish's while active, else the first active, else none", () => {
  const active = [{ id: "kit" }, { id: "bar" }];
  assert.equal(stationFor("bar", active), "bar");
  assert.equal(stationFor(null, active), "kit", "no station → the first active");
  assert.equal(stationFor("grill", active), "kit", "an inactive or deleted station → the first active");
  assert.equal(stationFor("bar", [{ id: "bar" }]), "bar");
  assert.equal(stationFor(null, []), null, "no active station at all");
});

test("a ticket is done when every live line is Ready or Served", () => {
  const line = (kitchenStatus: "PENDING" | "PREPARING" | "READY" | "SERVED", cancelled = false) => ({ kitchenStatus, cancelledAt: cancelled ? new Date() : null, deletedAt: null });
  assert.equal(isTicketDone([line("READY"), line("SERVED")]), true);
  assert.equal(isTicketDone([line("READY"), line("PREPARING")]), false);
  assert.equal(isTicketDone([line("READY"), line("PENDING", true)]), true, "a cancelled line doesn't hold it open");
  assert.equal(isTicketDone([line("PENDING", true)]), true, "nothing live left");
  assert.equal(isTicketDone([line("PENDING")]), false);
});

test("the Send to kitchen toast names the stations", () => {
  assert.equal(sentMessage([{ station: "Kitchen", count: 3 }, { station: "Bar", count: 1 }]), "Sent 3 to Kitchen and 1 to Bar.");
  assert.equal(sentMessage([{ station: "Kitchen", count: 2 }]), "Sent 2 to Kitchen.");
  assert.equal(sentMessage([{ station: "Kitchen", count: 1 }, { station: "Grill", count: 2 }, { station: "Bar", count: 1 }]), "Sent 1 to Kitchen, 2 to Grill and 1 to Bar.");
  assert.equal(sentMessage([]), null);
});

test("the kitchen's steps: Sent → Preparing → Ready forward, Ready → Preparing → Sent back; never Served", () => {
  assert.deepEqual([nextStep("PENDING"), nextStep("PREPARING"), nextStep("READY")], ["PREPARING", "READY", null]);
  assert.deepEqual([previousStep("READY"), previousStep("PREPARING"), previousStep("PENDING")], ["PREPARING", "PENDING", null]);
});

test("times: Preparing starts the cook, Ready ends it (and starts it if it never started); stepping back clears them", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const started = new Date("2026-10-30T11:50:00.000Z");
  assert.deepEqual(timesEntering("PREPARING", now, null), { startedAt: now });
  assert.deepEqual(timesEntering("READY", now, started), { readyAt: now });
  assert.deepEqual(timesEntering("READY", now, null), { startedAt: now, readyAt: now });
  assert.deepEqual(timesEntering("PENDING", now, null), {});
  assert.deepEqual(timesSteppingBackTo("PREPARING"), { readyAt: null });
  assert.deepEqual(timesSteppingBackTo("PENDING"), { startedAt: null, readyAt: null });
});

test("ticket timer mm:ss and late after the station's limit", () => {
  const sent = "2026-10-30T12:00:00.000Z";
  assert.equal(fmtElapsed(sent, Date.parse("2026-10-30T12:14:20.000Z")), "14:20");
  assert.equal(fmtElapsed(sent, Date.parse("2026-10-30T14:03:05.000Z")), "123:05");
  assert.equal(fmtElapsed(sent, Date.parse("2026-10-30T11:59:00.000Z")), "00:00", "a clock a little behind never goes negative");
  assert.equal(isLate(sent, 15, Date.parse("2026-10-30T12:15:00.000Z")), false, "exactly the limit isn't late");
  assert.equal(isLate(sent, 15, Date.parse("2026-10-30T12:15:01.000Z")), true);
});

test("board filters from the URL: a known station code (any case), else All; view done or active", () => {
  const codes = ["KIT", "BAR"];
  assert.deepEqual(readKdsFilter({ station: "bar", view: "done" }, codes), { station: "BAR", view: "done" });
  assert.deepEqual(readKdsFilter({ station: "GRL" }, codes), { station: null, view: "active" });
  assert.deepEqual(readKdsFilter({ view: "everything" }, codes), { station: null, view: "active" });
});

test("printed ticket time on the Lagos clock", () => {
  assert.equal(formatAppDateTime(new Date("2026-10-31T13:05:00.000Z")), "31 Oct 2026 14:05");
  assert.equal(formatAppDateTime(new Date("2026-10-31T23:30:00.000Z")), "1 Nov 2026 00:30");
});
