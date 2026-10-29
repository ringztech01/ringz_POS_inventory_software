// Run with: npx tsx --test lib/dateRanges.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  eachDay,
  lastNDaysRange,
  monthName,
  thisMonthRange,
  thisWeekRange,
  thisYearRange,
  todayInAppZone,
  todayRange,
  yearOf,
} from "./dateRanges";

describe("dateRanges (Africa/Lagos, UTC+1)", () => {
  test("today follows Lagos, not UTC: 23:30 UTC is already tomorrow", () => {
    assert.equal(todayInAppZone(new Date("2026-10-26T22:59:00Z")), "2026-10-26");
    assert.equal(todayInAppZone(new Date("2026-10-26T23:00:00Z")), "2026-10-27");
    assert.deepEqual(todayRange(new Date("2026-10-26T12:00:00Z")), { from: "2026-10-26", to: "2026-10-26" });
  });

  test("year boundary: Dec 31 23:30 UTC is Jan 1 in Lagos", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    assert.equal(todayInAppZone(now), "2027-01-01");
    assert.deepEqual(thisYearRange(now), { from: "2027-01-01", to: "2027-12-31" });
    assert.equal(yearOf(now), "2027");
    assert.equal(monthName(now), "January");
  });

  test("last 7 days include today; 7 labels", () => {
    const r = lastNDaysRange(7, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(r, { from: "2026-10-20", to: "2026-10-26" });
    assert.deepEqual(eachDay(r), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  test("this month: first to last day (Feb in a leap year, Dec rollover)", () => {
    assert.deepEqual(thisMonthRange(new Date("2028-02-10T12:00:00Z")), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(thisMonthRange(new Date("2026-12-15T12:00:00Z")), { from: "2026-12-01", to: "2026-12-31" });
    assert.equal(monthName(new Date("2026-10-26T12:00:00Z")), "October");
  });

  test("this week: Monday to Sunday", () => {
    // 2026-10-26 is a Monday; 2026-11-01 a Sunday.
    assert.deepEqual(thisWeekRange(new Date("2026-10-26T12:00:00Z")), { from: "2026-10-26", to: "2026-11-01" });
    assert.deepEqual(thisWeekRange(new Date("2026-11-01T12:00:00Z")), { from: "2026-10-26", to: "2026-11-01" });
  });

  test("addDays crosses month/year boundaries", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });
});
