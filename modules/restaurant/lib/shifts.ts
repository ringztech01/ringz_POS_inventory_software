import { todayInAppZone } from "@/lib/dateRanges";

// Clock in / out (Part 6f Step 6). Pure: the service keeps the shifts.
// Someone is on shift while a shift they started today is open. One still
// open from an earlier day is stale: they're asked to start a new one, and
// that closes the old one (endReason AUTO).

// Midnight at the start of `now`'s day on the app's calendar (Africa/Lagos:
// UTC+1 all year, no daylight saving).
export function startOfAppDay(now: Date): Date {
  return new Date(`${todayInAppZone(now)}T00:00:00.000+01:00`);
}

export type ShiftState = "ON" | "STALE" | "OFF";

export function shiftState(open: { startedAt: Date } | null, now: Date): ShiftState {
  if (!open) return "OFF";
  return open.startedAt >= startOfAppDay(now) ? "ON" : "STALE";
}

// After a PIN sign-in: ask "Start shift?" — clock in/out on, not on shift.
export const asksToStart = (clockOn: boolean, state: ShiftState) => clockOn && state !== "ON";
