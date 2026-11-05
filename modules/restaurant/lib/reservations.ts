import type { ReservationStatus } from "@prisma/client";
import { RESERVATION_GRACE_MINUTES } from "./tableStatus";

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  BOOKED: "Booked",
  SEATED: "Seated",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

const MINUTE = 60_000;

// A Booked party more than RESERVATION_GRACE_MINUTES past its time: flagged
// on the list (seat them or mark a no-show). It has also stopped holding its
// table — see tableStatus.
export function isLate(booking: { status: ReservationStatus; startsAt: Date }, now: Date): boolean {
  return booking.status === "BOOKED" && now.getTime() > booking.startsAt.getTime() + RESERVATION_GRACE_MINUTES * MINUTE;
}

// The no-double-booking rule: another Booked reservation on the same table
// less than `gapMinutes` before or after `startsAt` (BusinessSetting
// .restaurantBookingGapMinutes). Exactly `gapMinutes` apart is fine. Returns
// the nearest clash, or null.
export function bookingClash<B extends { status: ReservationStatus; startsAt: Date }>(
  existing: readonly B[],
  startsAt: Date,
  gapMinutes: number,
): B | null {
  const distance = (booking: B) => Math.abs(booking.startsAt.getTime() - startsAt.getTime());
  return (
    existing
      .filter((booking) => booking.status === "BOOKED" && distance(booking) < gapMinutes * MINUTE)
      .sort((a, b) => distance(a) - distance(b))[0] ?? null
  );
}
