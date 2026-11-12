import { z } from "zod";
import { addDays, todayInAppZone, type DateRange } from "@/lib/dateRanges";
import { appDateTime, isCalendarDay } from "../../../lib/time";
import { dayStartLabel } from "../../../lib/reportTabs";

// Restaurant Reports' filters (Step 1): read from the URL with zod and turned
// into the period's window on the business calendar — Africa/Lagos days that
// start at the business's day start (BusinessSetting.restaurantDayStartMinutes),
// so with a 04:00 start an order closed at 01:30 counts on the day before.
// Pure: no database (the caller passes the day start and the clock).

export const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "BAR_TAB", "DELIVERY"] as const;
export type ReportOrderType = (typeof ORDER_TYPES)[number];

// The longest period one report covers.
export const MAX_REPORT_DAYS = 366;

const day = z.string().refine(isCalendarDay);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
// Anything unreadable is dropped (the report shows without that filter),
// never an error page.
const filterSchema = z.object({
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  area: id.optional().catch(undefined),
  waiter: id.optional().catch(undefined),
  type: z.enum(ORDER_TYPES).optional().catch(undefined),
  station: id.optional().catch(undefined),
  device: id.optional().catch(undefined),
});

export type ReportFilters = {
  area: string | null;
  waiter: string | null;
  type: ReportOrderType | null;
  station: string | null;
  device: string | null;
};

// One stretch of business days and the instants it covers: [start, end).
export type ReportPeriod = DateRange & { start: Date; end: Date; days: number };

export type ReportWindow = ReportPeriod & {
  // The equal stretch just before (the KPIs' change).
  previous: ReportPeriod;
  // Which quick range it is, if any ("Last 7 days").
  preset: ReportPresetKey | null;
};

export type ReportPresetKey = "today" | "yesterday" | "7d" | "month" | "lastmonth";

export const PRESET_LABELS: Record<ReportPresetKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  month: "This month",
  lastmonth: "Last month",
};

// The default period (no dates in the URL).
export const DEFAULT_PRESET: ReportPresetKey = "7d";

// The business day `at` falls on: the calendar day of (at − day start).
export function businessDay(at: Date, dayStartMinutes: number): string {
  return todayInAppZone(new Date(at.getTime() - dayStartMinutes * 60_000));
}

// When business day `dayKey` starts.
export function businessDayStart(dayKey: string, dayStartMinutes: number): Date {
  return appDateTime(dayKey, dayStartLabel(dayStartMinutes));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function periodOf(range: DateRange, dayStartMinutes: number): ReportPeriod {
  return {
    ...range,
    start: businessDayStart(range.from, dayStartMinutes),
    end: businessDayStart(addDays(range.to, 1), dayStartMinutes),
    days: daysBetween(range.from, range.to),
  };
}

// The quick ranges, on the business calendar as of `now`. "This month" runs
// to today (so the previous equal period compares like with like).
export function reportPresets(now: Date, dayStartMinutes: number): Record<ReportPresetKey, DateRange> {
  const today = businessDay(now, dayStartMinutes);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(firstOfMonth, -1);
  return {
    today: { from: today, to: today },
    yesterday: { from: addDays(today, -1), to: addDays(today, -1) },
    "7d": { from: addDays(today, -6), to: today },
    month: { from: firstOfMonth, to: today },
    lastmonth: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  };
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export type ParsedReportFilters = { filters: ReportFilters; window: ReportWindow };

// The URL's filters and the period they cover. Custom dates: a reversed
// range is swapped, one date alone is that day, longer than MAX_REPORT_DAYS
// is cut to that many from the start.
export function parseReportFilters(params: RawParams, options: { dayStartMinutes: number; now?: Date }): ParsedReportFilters {
  const { dayStartMinutes } = options;
  const now = options.now ?? new Date();
  const raw = filterSchema.parse(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, first(value) || undefined])));
  const presets = reportPresets(now, dayStartMinutes);

  let range: DateRange;
  if (raw.from || raw.to) {
    const [a, b] = [raw.from ?? raw.to!, raw.to ?? raw.from!];
    const [from, to] = a <= b ? [a, b] : [b, a];
    range = { from, to: daysBetween(from, to) > MAX_REPORT_DAYS ? addDays(from, MAX_REPORT_DAYS - 1) : to };
  } else {
    range = presets[DEFAULT_PRESET];
  }

  const period = periodOf(range, dayStartMinutes);
  const previous = periodOf({ from: addDays(range.from, -period.days), to: addDays(range.from, -1) }, dayStartMinutes);
  const preset = (Object.keys(presets) as ReportPresetKey[]).find((key) => presets[key].from === range.from && presets[key].to === range.to) ?? null;

  return {
    filters: {
      area: raw.area ?? null,
      waiter: raw.waiter ?? null,
      type: raw.type ?? null,
      station: raw.station ?? null,
      device: raw.device ?? null,
    },
    window: { ...period, previous, preset },
  };
}

// Drops filters that name something the business doesn't have (a deleted
// area, someone who never waited a table), so the bar and the report agree.
export function keepKnown(filters: ReportFilters, known: { areas: string[]; waiters: string[]; stations: string[]; devices: string[] }): ReportFilters {
  const pick = (value: string | null, list: string[]) => (value && list.includes(value) ? value : null);
  return {
    area: pick(filters.area, known.areas),
    waiter: pick(filters.waiter, known.waiters),
    type: filters.type,
    station: pick(filters.station, known.stations),
    device: pick(filters.device, known.devices),
  };
}
