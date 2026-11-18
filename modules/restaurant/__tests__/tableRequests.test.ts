// Run with: npx tsx --test modules/restaurant/__tests__/tableRequests.test.ts
// Part 8 Step 6: service requests' rules (lib/tableRequests.ts) — when a
// request is still active, the per-table limits, what the guest sees, and
// whose toast a request is.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACK_CLEARS_MIN,
  OPEN_LAPSES_MIN,
  RATE_LIMIT_MS,
  activeRequestWhere,
  announcement,
  guestRequests,
  isActive,
  isForMe,
  refuseRequest,
  toAnnounce,
  type FloorRequest,
  type RequestState,
  type TableRequestType,
} from "../lib/tableRequests";

const now = new Date("2026-11-17T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const req = (type: TableRequestType, status: RequestState["status"], createdMsAgo: number, ackMsAgo: number | null = null) => ({
  type,
  status,
  createdAt: ago(createdMsAgo),
  ackAt: ackMsAgo === null ? null : ago(ackMsAgo),
});

test("OPEN stays active until it lapses; ACKNOWLEDGED until it clears; DONE never", () => {
  assert.equal(isActive(req("CALL_WAITER", "OPEN", 5 * MIN), now), true);
  assert.equal(isActive(req("CALL_WAITER", "OPEN", OPEN_LAPSES_MIN * MIN - 1), now), true);
  assert.equal(isActive(req("CALL_WAITER", "OPEN", OPEN_LAPSES_MIN * MIN), now), false, "yesterday's bell lapses");
  assert.equal(isActive(req("CALL_WAITER", "ACKNOWLEDGED", 20 * MIN, 2 * MIN), now), true);
  assert.equal(isActive(req("CALL_WAITER", "ACKNOWLEDGED", 20 * MIN, ACK_CLEARS_MIN * MIN), now), false);
  assert.equal(isActive(req("CALL_WAITER", "ACKNOWLEDGED", 20 * MIN, null), now), false, "acknowledged with no time: not active");
  assert.equal(isActive(req("CALL_WAITER", "DONE", 1000), now), false);
});

test("the Prisma where says the same as isActive", () => {
  const where = activeRequestWhere(now);
  assert.deepEqual(where.OR[0], { status: "OPEN", createdAt: { gt: ago(OPEN_LAPSES_MIN * MIN) } });
  assert.deepEqual(where.OR[1], { status: "ACKNOWLEDGED", ackAt: { gt: ago(ACK_CLEARS_MIN * MIN) } });
});

test("one active request of each type per table", () => {
  assert.equal(refuseRequest("CALL_WAITER", [], now), null);
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "OPEN", 5 * MIN)], now), "already");
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "ACKNOWLEDGED", 5 * MIN, 2 * MIN)], now), "already", "a waiter's on the way");
  assert.equal(refuseRequest("REQUEST_BILL", [req("CALL_WAITER", "OPEN", 5 * MIN)], now), null, "the other type is fine");
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "DONE", 5 * MIN)], now), null, "done: call again");
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "ACKNOWLEDGED", 30 * MIN, ACK_CLEARS_MIN * MIN + 1)], now), null, "cleared: call again");
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "OPEN", OPEN_LAPSES_MIN * MIN + 1)], now), null, "lapsed: call again");
});

test("at most one new request per table per minute, of any type", () => {
  assert.equal(refuseRequest("REQUEST_BILL", [req("CALL_WAITER", "DONE", 10_000)], now), "too_soon");
  assert.equal(refuseRequest("REQUEST_BILL", [req("CALL_WAITER", "OPEN", RATE_LIMIT_MS - 1)], now), "too_soon");
  assert.equal(refuseRequest("REQUEST_BILL", [req("CALL_WAITER", "OPEN", RATE_LIMIT_MS)], now), null);
  // The same type: "already" wins (the clearer message).
  assert.equal(refuseRequest("CALL_WAITER", [req("CALL_WAITER", "OPEN", 1000)], now), "already");
});

test("the guest sees waiting, on the way or nothing — per type", () => {
  assert.deepEqual(guestRequests([], now), { CALL_WAITER: null, REQUEST_BILL: null });
  assert.deepEqual(guestRequests([req("CALL_WAITER", "OPEN", MIN), req("REQUEST_BILL", "ACKNOWLEDGED", 3 * MIN, MIN)], now), { CALL_WAITER: "open", REQUEST_BILL: "acknowledged" });
  assert.deepEqual(guestRequests([req("CALL_WAITER", "DONE", MIN), req("REQUEST_BILL", "OPEN", OPEN_LAPSES_MIN * MIN)], now), { CALL_WAITER: null, REQUEST_BILL: null });
});

const floor = (over: Partial<FloorRequest>): FloorRequest => ({
  id: "r1",
  tableId: "t1",
  tableName: "5",
  areaId: "a1",
  areaName: "Terrace",
  type: "CALL_WAITER",
  status: "OPEN",
  minutes: 0,
  waiterIds: [],
  ...over,
});

test("a toast for the table's waiter — or everyone when no one has the table", () => {
  assert.equal(isForMe(floor({ waiterIds: ["ada"] }), "ada"), true);
  assert.equal(isForMe(floor({ waiterIds: ["ada"] }), "ben"), false);
  assert.equal(isForMe(floor({ waiterIds: ["ada", "ben"] }), "ben"), true, "separate checks: each waiter");
  assert.equal(isForMe(floor({ waiterIds: [] }), "ben"), true);
  assert.equal(isForMe(floor({ waiterIds: [] }), null), true);
  assert.equal(isForMe(floor({ waiterIds: ["ada"] }), null), false);
});

test("each new OPEN request is announced once; acknowledged ones never", () => {
  const list = [floor({ id: "r1" }), floor({ id: "r2", status: "ACKNOWLEDGED" }), floor({ id: "r3", waiterIds: ["ada"] }), floor({ id: "r4", waiterIds: ["ben"] })];
  assert.deepEqual(toAnnounce(list, "ben", new Set()).map((r) => r.id), ["r1", "r4"]);
  assert.deepEqual(toAnnounce(list, "ben", new Set(["r1"])).map((r) => r.id), ["r4"]);
});

test("the toast names the table, and its area when it's another one", () => {
  assert.equal(announcement(floor({}), "a1"), "Table 5 · Call waiter");
  assert.equal(announcement(floor({ type: "REQUEST_BILL" }), "a2"), "Table 5 (Terrace) · Request bill");
});
