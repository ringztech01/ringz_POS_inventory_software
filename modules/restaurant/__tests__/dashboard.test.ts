// Run with: npx tsx --test modules/restaurant/__tests__/dashboard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  averageBill,
  countDeltaNote,
  floorShare,
  formatPrepTime,
  hourChart,
  moneyDeltaNote,
  percentNote,
  periodBounds,
  resolvePeriod,
  stockLevel,
} from "../lib/dashboard";

// Thu 29 Oct 2026, 14:00 in Lagos.
const NOW = new Date("2026-10-29T13:00:00.000Z");

test("the date filter: Today, Yesterday, Last 7 days — each against the same days a week earlier", () => {
  const today = resolvePeriod("today", NOW);
  assert.deepEqual([today.range, today.previous, today.previousName, today.revenueLabel, today.dayText], [
    { from: "2026-10-29", to: "2026-10-29" },
    { from: "2026-10-22", to: "2026-10-22" },
    "last Thu",
    "Revenue today",
    "Thu 29 Oct",
  ]);
  const yesterday = resolvePeriod("yesterday", NOW);
  assert.deepEqual([yesterday.range, yesterday.previous, yesterday.previousName, yesterday.revenueLabel], [
    { from: "2026-10-28", to: "2026-10-28" },
    { from: "2026-10-21", to: "2026-10-21" },
    "last Wed",
    "Revenue yesterday",
  ]);
  const week = resolvePeriod("7d", NOW);
  assert.deepEqual([week.range, week.previous, week.previousName, week.dayText], [
    { from: "2026-10-23", to: "2026-10-29" },
    { from: "2026-10-16", to: "2026-10-22" },
    "the previous 7 days",
    "23 Oct – 29 Oct",
  ]);
  assert.equal(resolvePeriod("month", NOW).key, "today");
  assert.equal(resolvePeriod(undefined, NOW).key, "today");
  assert.equal(resolvePeriod("constructor", NOW).key, "today");
});

test("the range runs to the end of its last day, on the Lagos clock", () => {
  assert.deepEqual(periodBounds({ from: "2026-10-23", to: "2026-10-29" }), {
    start: new Date("2026-10-22T23:00:00.000Z"),
    end: new Date("2026-10-29T23:00:00.000Z"),
  });
  // Just after midnight in Lagos is already the 30th.
  assert.equal(resolvePeriod("today", new Date("2026-10-29T23:30:00.000Z")).range.from, "2026-10-30");
});

test("comparison notes", () => {
  assert.equal(percentNote("1120.00", "1000.00", "last Thu"), "+12% vs last Thu");
  assert.equal(percentNote("880", "1000", "last Thu"), "−12% vs last Thu");
  assert.equal(percentNote("100", "300", "last Thu"), "−67% vs last Thu");
  assert.equal(percentNote("0", "0", "last Thu"), "Same as last Thu");
  assert.equal(percentNote("250.5", "0", "last Thu"), "+₦250.50 vs last Thu");
  assert.equal(moneyDeltaNote("59.34", "56.24", "last Thu"), "+₦3.10 vs last Thu");
  assert.equal(moneyDeltaNote("50", "56.24", "last Thu"), "−₦6.24 vs last Thu");
  assert.equal(moneyDeltaNote("10.00", "10", "last Thu"), "Same as last Thu");
  assert.equal(countDeltaNote(142, 134, "the previous 7 days"), "+8 vs the previous 7 days");
  assert.equal(countDeltaNote(4, 6, "last Thu"), "−2 vs last Thu");
  assert.equal(countDeltaNote(3, 3, "last Thu"), "Same as last Thu");
});

test("average bill, prep time, floor share", () => {
  assert.equal(averageBill("8426.50", 142), "59.34");
  assert.equal(averageBill("100", 3), "33.33");
  assert.equal(averageBill("0.00", 0), "0.00");
  assert.equal(formatPrepTime(860), "14m 20s");
  assert.equal(formatPrepTime(720.4), "12m 00s");
  assert.equal(formatPrepTime(null), "0m 00s");
  assert.equal(floorShare(7, 20), "35% of floor");
  assert.equal(floorShare(0, 0), "No tables yet");
});

test("sales by hour: 10–23 always, widened by sales outside; the peak is the biggest (earliest on a tie)", () => {
  const chart = hourChart([
    { hour: 12, total: "500.00" },
    { hour: 13, total: "1842.00" },
    { hour: 20, total: "1842.00" },
    { hour: 9, total: "100.00" },
  ]);
  assert.deepEqual(chart.peak, { label: "13:00", total: "1842.00" });
  assert.equal(chart.bars[0].label, "09");
  assert.equal(chart.bars.at(-1)?.label, "23");
  assert.equal(chart.bars.length, 15);
  assert.deepEqual(chart.bars.filter((b) => b.peak).map((b) => b.label), ["13"]);
  assert.equal(chart.bars.find((b) => b.hour === 12)?.pct, 27.1);
  assert.equal(chart.bars.find((b) => b.hour === 20)?.pct, 100);
  assert.equal(chart.bars.find((b) => b.hour === 15)?.total, "0.00");
});

test("sales by hour with no sales: 10–23 at zero, no peak", () => {
  const chart = hourChart([]);
  assert.equal(chart.peak, null);
  assert.deepEqual([chart.bars.length, chart.bars.every((b) => b.pct === 0 && !b.peak)], [14, true]);
});

test("low stock: Critical at half the alert level or less, else Low", () => {
  assert.equal(stockLevel(3, 10), "Critical");
  assert.equal(stockLevel(5, 10), "Critical");
  assert.equal(stockLevel(6, 10), "Low");
  assert.equal(stockLevel(10, 10), "Low");
  assert.equal(stockLevel(0, 2), "Critical");
});
