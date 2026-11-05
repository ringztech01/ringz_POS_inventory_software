import { addDays, APP_TIME_ZONE } from "@/lib/dateRanges";

// Clock times on the app's calendar (lib/dateRanges.ts: Africa/Lagos).
// Bookings are typed as a day and a time in that zone and stored as instants.

const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, timeZoneName: "longOffset" });

// Minutes the app's zone is ahead of UTC at `at` (Lagos: 60).
export function appZoneOffsetMinutes(at: Date): number {
  const name = offsetFormat.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

// "YYYY-MM-DD" + "HH:MM" on the app's clock → that instant.
export function appDateTime(day: string, time: string): Date {
  const asUtc = Date.parse(`${day}T${time}:00.000Z`);
  return new Date(asUtc - appZoneOffsetMinutes(new Date(asUtc)) * 60_000);
}

// One app-calendar day as [start, end).
export function appDayBounds(day: string): { start: Date; end: Date } {
  return { start: appDateTime(day, "00:00"), end: appDateTime(addDays(day, 1), "00:00") };
}

// A real calendar day as "YYYY-MM-DD" (not 2026-02-30).
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// "19:30" on the app's clock.
export function formatAppTime(at: Date): string {
  return timeFormat.format(at);
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

// "Today", "Tomorrow", "Yesterday", or "Thu 30 Oct".
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayFormat.format(new Date(`${day}T00:00:00.000Z`)).replace(",", "");
}

// 120 → "2 hours", 90 → "90 minutes".
export function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

// How long an order has been open: "6m", "1h 12m".
export function formatOpenFor(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// "31 Oct 2026 14:05" on the app's clock (printed tickets).
export function formatAppDateTime(at: Date): string {
  return dateTimeFormat.format(at).replace(",", "");
}
