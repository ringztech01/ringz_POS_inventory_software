import { addDays, lastNDaysRange, type DateRange } from "@/lib/dateRanges";
import { isCalendarDay } from "./time";

// The prep-time report's pure rules. Times are seconds, per order line:
//   wait  = sent → started (Preparing)
//   cook  = started → ready
//   total = sent → ready
// A line is late when its total is over its station's late limit.

// Late share above this shows in red.
export const LATE_WARN_RATE = 0.2;

// "12%" (whole percent); "—" with nothing cooked.
export function lateRateText(late: number, lines: number): string {
  return lines === 0 ? "—" : `${Math.round((late / lines) * 100)}%`;
}

export function isLateRateHigh(late: number, lines: number): boolean {
  return lines > 0 && late / lines > LATE_WARN_RATE;
}

// The report's filters from the URL: ?from&to (calendar days, default the
// last 7; swapped if backwards; to includes the whole day) and ?station
// (a known station id, else every station).
export function readPrepFilter(
  params: { from?: string; to?: string; station?: string },
  stationIds: readonly string[],
  now: Date = new Date(),
): { range: DateRange; stationId: string | null } {
  const fallback = lastNDaysRange(7, now);
  let from = isCalendarDay(params.from) ? params.from : isCalendarDay(params.to) ? params.to : fallback.from;
  let to = isCalendarDay(params.to) ? params.to : isCalendarDay(params.from) ? params.from : fallback.to;
  if (from > to) [from, to] = [to, from];
  // At most a year, so the report stays quick.
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const stationId = params.station && stationIds.includes(params.station) ? params.station : null;
  return { range: { from, to }, stationId };
}
