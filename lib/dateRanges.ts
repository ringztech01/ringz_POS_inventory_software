// The app's calendar: "today", "last 7 days", "this week", "this month" and
// "this year" — defined once, in the app's timezone (Africa/Lagos, UTC+1, no
// DST). Every dashboard section uses these.
//
// Ranges are inclusive calendar days as "YYYY-MM-DD" strings. Document dates
// (Sale.date, Purchase.date, Expense.date, SalePayment.date, …) are
// date-only values stored at UTC midnight of the chosen day, so a range
// becomes a DB filter with dateRangeWhere(from, to) (purchases/queries.ts) —
// the same filter the list pages use for their date range.

export const APP_TIME_ZONE = "Africa/Lagos";

export type DateRange = { from: string; to: string };

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" of `now` on the app's calendar.
export function todayInAppZone(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Calendar-day arithmetic on "YYYY-MM-DD" strings (UTC, so no DST/offset).
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function todayRange(now: Date = new Date()): DateRange {
  const today = todayInAppZone(now);
  return { from: today, to: today };
}

// The last `n` days including today (the weekly chart: n = 7).
export function lastNDaysRange(n: number, now: Date = new Date()): DateRange {
  const today = todayInAppZone(now);
  return { from: addDays(today, -(n - 1)), to: today };
}

// Monday → Sunday of the current week.
export function thisWeekRange(now: Date = new Date()): DateRange {
  const today = todayInAppZone(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const monday = addDays(today, -((weekday + 6) % 7));
  return { from: monday, to: addDays(monday, 6) };
}

// 1st → last day of the current month.
export function thisMonthRange(now: Date = new Date()): DateRange {
  const [year, month] = todayInAppZone(now).split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextFirst = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from: first, to: addDays(nextFirst, -1) };
}

// Jan 1 → Dec 31 of the current year.
export function thisYearRange(now: Date = new Date()): DateRange {
  const year = todayInAppZone(now).slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// Every day in a range, in order (to fill a chart's missing days with 0).
export function eachDay({ from, to }: DateRange): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

// Labels for the section titles ("May", "2026").
export function monthName(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, month: "long" }).format(now);
}

export function yearOf(now: Date = new Date()): string {
  return todayInAppZone(now).slice(0, 4);
}
