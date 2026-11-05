// Run with: npx tsx --test modules/restaurant/__tests__/prepTimes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLateRateHigh, lateRateText, readPrepFilter } from "../lib/prepTimes";

test("late share: whole percent, '—' with nothing cooked; red only above 20%", () => {
  assert.equal(lateRateText(1, 3), "33%");
  assert.equal(lateRateText(0, 5), "0%");
  assert.equal(lateRateText(0, 0), "—");
  assert.equal(isLateRateHigh(1, 5), false, "exactly 20% isn't above");
  assert.equal(isLateRateHigh(2, 9), true);
  assert.equal(isLateRateHigh(0, 0), false);
});

test("filters: last 7 days by default; one date alone is that day; backwards dates swapped; at most a year; unknown station = all", () => {
  const now = new Date("2026-10-31T10:00:00.000Z");
  const ids = ["kit", "bar"];
  assert.deepEqual(readPrepFilter({}, ids, now), { range: { from: "2026-10-25", to: "2026-10-31" }, stationId: null });
  assert.deepEqual(readPrepFilter({ from: "2026-10-01", to: "2026-10-15", station: "bar" }, ids, now), { range: { from: "2026-10-01", to: "2026-10-15" }, stationId: "bar" });
  assert.deepEqual(readPrepFilter({ from: "2026-10-20" }, ids, now).range, { from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(readPrepFilter({ from: "2026-10-15", to: "2026-10-01" }, ids, now).range, { from: "2026-10-01", to: "2026-10-15" });
  assert.deepEqual(readPrepFilter({ from: "2024-01-01", to: "2026-10-31" }, ids, now).range, { from: "2025-10-30", to: "2026-10-31" });
  assert.deepEqual(readPrepFilter({ from: "2026-02-30", to: "nope", station: "grill" }, ids, now), { range: { from: "2026-10-25", to: "2026-10-31" }, stationId: null });
});
