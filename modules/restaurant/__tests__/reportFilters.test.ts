// Restaurant Reports, Step 1: the filters read from the URL and the period's
// window on the business calendar (Africa/Lagos, UTC+1; the day start).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { businessDay, businessDayStart, keepKnown, MAX_REPORT_DAYS, parseReportFilters, reportPresets } from "../server/queries/reports/filters";
import { dayStartSchema } from "../schemas/reports";
import { filterQuery, reportDayLabel, reportTabFor, REPORT_TABS } from "../lib/reportTabs";

// 12 Nov 2026 14:00 in Lagos.
const NOW = new Date("2026-11-12T13:00:00.000Z");

describe("the business day", () => {
  test("midnight start: the calendar day in Lagos", () => {
    assert.equal(businessDay(new Date("2026-11-12T23:30:00.000Z"), 0), "2026-11-13", "00:30 Lagos is the 13th");
    assert.equal(businessDayStart("2026-11-12", 0).toISOString(), "2026-11-11T23:00:00.000Z");
  });

  test("04:00 start: an order closed at 01:30 counts on the day before", () => {
    // 01:30 Lagos on the 13th = 00:30 UTC.
    assert.equal(businessDay(new Date("2026-11-13T00:30:00.000Z"), 240), "2026-11-12");
    // 04:00 Lagos on the 13th = 03:00 UTC: the 13th has begun.
    assert.equal(businessDay(new Date("2026-11-13T03:00:00.000Z"), 240), "2026-11-13");
    assert.equal(businessDay(new Date("2026-11-13T02:59:59.999Z"), 240), "2026-11-12");
    assert.equal(businessDayStart("2026-11-13", 240).toISOString(), "2026-11-13T03:00:00.000Z");
  });

  test("a day's window is [start, next start)", () => {
    const { window } = parseReportFilters({ from: "2026-11-12", to: "2026-11-12" }, { dayStartMinutes: 240, now: NOW });
    assert.equal(window.start.toISOString(), "2026-11-12T03:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-11-13T03:00:00.000Z");
    assert.equal(window.days, 1);
    const at = (iso: string) => new Date(iso) >= window.start && new Date(iso) < window.end;
    assert.ok(at("2026-11-13T00:30:00.000Z"), "01:30 on the 13th is the 12th's");
    assert.ok(!at("2026-11-12T00:30:00.000Z"), "01:30 on the 12th is the 11th's");
  });
});

describe("quick ranges", () => {
  test("on the business calendar as of now", () => {
    const p = reportPresets(NOW, 0);
    assert.deepEqual(p.today, { from: "2026-11-12", to: "2026-11-12" });
    assert.deepEqual(p.yesterday, { from: "2026-11-11", to: "2026-11-11" });
    assert.deepEqual(p["7d"], { from: "2026-11-06", to: "2026-11-12" });
    assert.deepEqual(p.month, { from: "2026-11-01", to: "2026-11-12" });
    assert.deepEqual(p.lastmonth, { from: "2026-10-01", to: "2026-10-31" });
  });

  test("before the day start, today is still yesterday's business day", () => {
    // 02:00 Lagos on 1 Dec with a 04:00 start: still 30 Nov.
    const p = reportPresets(new Date("2026-12-01T01:00:00.000Z"), 240);
    assert.deepEqual(p.today, { from: "2026-11-30", to: "2026-11-30" });
    assert.deepEqual(p.month, { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(p.lastmonth, { from: "2026-10-01", to: "2026-10-31" });
  });

  test("January's last month is December", () => {
    assert.deepEqual(reportPresets(new Date("2027-01-15T12:00:00.000Z"), 0).lastmonth, { from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("parsing the URL", () => {
  test("no dates: the last 7 days, and the 7 before for comparison", () => {
    const { window, filters } = parseReportFilters({}, { dayStartMinutes: 0, now: NOW });
    assert.equal(window.preset, "7d");
    assert.deepEqual([window.from, window.to, window.days], ["2026-11-06", "2026-11-12", 7]);
    assert.deepEqual([window.previous.from, window.previous.to, window.previous.days], ["2026-10-30", "2026-11-05", 7]);
    assert.equal(window.previous.end.getTime(), window.start.getTime(), "back to back");
    assert.deepEqual(filters, { area: null, waiter: null, type: null, station: null, device: null });
  });

  test("custom dates: reversed are swapped, one alone is that day, too long is cut", () => {
    const reversed = parseReportFilters({ from: "2026-11-10", to: "2026-11-01" }, { dayStartMinutes: 0, now: NOW }).window;
    assert.deepEqual([reversed.from, reversed.to, reversed.days, reversed.preset], ["2026-11-01", "2026-11-10", 10, null]);
    const one = parseReportFilters({ to: "2026-11-03" }, { dayStartMinutes: 0, now: NOW }).window;
    assert.deepEqual([one.from, one.to], ["2026-11-03", "2026-11-03"]);
    const long = parseReportFilters({ from: "2024-01-01", to: "2026-11-12" }, { dayStartMinutes: 0, now: NOW }).window;
    assert.equal(long.days, MAX_REPORT_DAYS);
    assert.equal(long.from, "2024-01-01");
  });

  test("a matching custom range is recognised as its quick range", () => {
    assert.equal(parseReportFilters({ from: "2026-11-01", to: "2026-11-12" }, { dayStartMinutes: 0, now: NOW }).window.preset, "month");
  });

  test("filters: read when valid, dropped when not (never an error)", () => {
    const ok = parseReportFilters({ area: "area_1", waiter: "cmw1", type: "BAR_TAB", station: "st-2", device: "0b8e-uuid" }, { dayStartMinutes: 0, now: NOW }).filters;
    assert.deepEqual(ok, { area: "area_1", waiter: "cmw1", type: "BAR_TAB", station: "st-2", device: "0b8e-uuid" });
    const bad = parseReportFilters({ from: "2026-02-30", to: "nope", area: "x' OR 1=1", type: "PICNIC", waiter: ["w1", "w2"], station: "" }, { dayStartMinutes: 0, now: NOW });
    assert.deepEqual(bad.filters, { area: null, waiter: "w1", type: null, station: null, device: null });
    assert.equal(bad.window.preset, "7d", "bad dates: the default period");
  });

  test("keepKnown drops what the business doesn't have", () => {
    const f = { area: "a1", waiter: "gone", type: "DINE_IN" as const, station: "s1", device: "d9" };
    assert.deepEqual(keepKnown(f, { areas: ["a1"], waiters: ["w1"], stations: ["s1"], devices: [] }), { area: "a1", waiter: null, type: "DINE_IN", station: "s1", device: null });
  });
});

describe("tabs", () => {
  test("nine tabs; Overview is the index, the rest are segments", () => {
    assert.deepEqual(REPORT_TABS.map((t) => t.label), ["Overview", "By dish", "By waiter", "By table", "By order type", "Payments & tips", "Waste", "Voids & discounts", "Shifts & cash-up"]);
    assert.equal(reportTabFor("dishes")?.key, "dishes");
    assert.equal(reportTabFor("overview"), null, "/restaurant/reports/overview isn't a route");
    assert.equal(reportTabFor("prep-times"), null);
  });

  test("the period's days, as written in the header", () => {
    assert.equal(reportDayLabel("2026-11-11"), "Wed 11 Nov 2026");
  });

  test("only the filters go from tab to tab", () => {
    assert.equal(filterQuery(new URLSearchParams("from=2026-11-01&to=2026-11-07&waiter=w1&sort=net&page=3")), "?from=2026-11-01&to=2026-11-07&waiter=w1");
    assert.equal(filterQuery(new URLSearchParams("")), "");
  });
});

describe("the day-start setting", () => {
  test("00:00 to 06:00 in steps of 30 minutes; nothing else", () => {
    for (const minutes of [0, 30, 240, 360]) assert.ok(dayStartSchema.safeParse({ minutes }).success, String(minutes));
    for (const minutes of [-30, 15, 390, 1440]) assert.equal(dayStartSchema.safeParse({ minutes }).error?.issues[0]?.message, "Pick one of the times.", String(minutes));
    assert.ok(!dayStartSchema.safeParse({ minutes: "240" }).success);
  });
});
