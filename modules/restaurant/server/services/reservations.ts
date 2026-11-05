import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { invalid, type ActionFailure, type ActionResult } from "../../lib/actionResult";
import { orderRef } from "../../lib/format";
import { bookingClash } from "../../lib/reservations";
import { tableStatus } from "../../lib/tableStatus";
import { appDateTime, formatAppTime } from "../../lib/time";
import type { ReservationField, ReservationInput } from "../../schemas/reservation";
import { lockTable } from "../locks";
import { isUniqueViolation } from "../prismaErrors";
import { tableStateSelect } from "../queries/tables";
import { getTableStatusRules } from "../rules";

// The booking rules, without the permission check and input parsing (the
// server actions in ../actions/reservations.ts do those). Kept apart so the
// concurrency tests can run them against a database.

export type BookingResult = ActionResult<ReservationField>;
export type SeatResult = { ok: true; orderId: string; orderRef: string } | ActionFailure;

const MINUTE = 60_000;
export const NOT_OPEN = "This booking is no longer open — it was seated, cancelled or marked as a no-show.";

// The booking row, locked while it's changed (two devices can't both seat
// or cancel it). Null when missing or soft-deleted.
async function lockReservation(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM Reservation WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.reservation.findUnique({
    where: { id },
    select: { status: true, startsAt: true, tableId: true, customerId: true, guestName: true, partySize: true },
  });
}

// A new Booked reservation (input already validated by reservationSchema).
// Refused in the past, for an inactive customer or table, a table too small
// for the party, or within the booking gap of another Booked one on the
// same table — checked with the table row locked, so two bookings for one
// slot can't both get in.
export async function bookTable(input: ReservationInput, createdById: string): Promise<BookingResult> {
  const { customerId, partySize, date, time, tableId } = input;
  let { guestName, guestPhone } = input;

  // Not in the past (the current minute is fine).
  const startsAt = appDateTime(date, time);
  if (startsAt.getTime() < Math.floor(Date.now() / MINUTE) * MINUTE) {
    return invalid<ReservationField>({ time: ["That time has already passed. Pick a later one."] });
  }

  // A picked customer's own name and phone are used, not what was typed.
  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null, isDefault: false },
      select: { name: true, phoneNumber: true },
    });
    if (!customer) return invalid<ReservationField>({ customerId: ["Choose an active customer."] });
    guestName = customer.name;
    guestPhone = customer.phoneNumber;
  }

  const gapMinutes = (await getBusinessSettings()).restaurantBookingGapMinutes;

  return prisma.$transaction(async (tx): Promise<BookingResult> => {
    if (!(await lockTable(tx, tableId))) return invalid<ReservationField>({ tableId: ["Choose an active table."] });
    const table = await tx.table.findFirst({
      where: { id: tableId, deletedAt: null, area: { deletedAt: null } },
      select: { name: true, seats: true },
    });
    if (!table) return invalid<ReservationField>({ tableId: ["Choose an active table."] });
    if (table.seats < partySize) {
      return invalid<ReservationField>({ tableId: [`${table.name} seats ${table.seats}. Choose a bigger table.`] });
    }

    const nearby = await tx.reservation.findMany({
      where: {
        tableId,
        status: "BOOKED",
        deletedAt: null,
        startsAt: { gt: new Date(startsAt.getTime() - gapMinutes * MINUTE), lt: new Date(startsAt.getTime() + gapMinutes * MINUTE) },
      },
      select: { status: true, startsAt: true },
    });
    const clash = bookingClash(nearby, startsAt, gapMinutes);
    if (clash) {
      const message = `${table.name} is already booked at ${formatAppTime(clash.startsAt)}.`;
      return { ok: false, error: message, fieldErrors: { tableId: [message] } };
    }

    await tx.reservation.create({
      data: { tableId, customerId: customerId || null, guestName, guestPhone, partySize, startsAt, createdById },
    });
    return { ok: true };
  });
}

// Seat a Booked party: opens a dine-in Order on its table (the party size as
// guests, `waiterId` as waiter, the area's warehouse), marks the booking
// Seated and links the two. Refused while the table has an open order or
// still needs cleaning — tableStatus decides, as everywhere.
export async function seatBooking(id: string, waiterId: string): Promise<SeatResult> {
  const rules = await getTableStatusRules();
  try {
    return await prisma.$transaction(async (tx): Promise<SeatResult> => {
      const booking = await lockReservation(tx, id);
      if (!booking || booking.status !== "BOOKED") return { ok: false, error: NOT_OPEN };

      if (!(await lockTable(tx, booking.tableId))) {
        return { ok: false, error: "Its table has been deleted. Cancel this booking and book another table." };
      }
      const now = new Date();
      const table = await tx.table.findUniqueOrThrow({
        where: { id: booking.tableId },
        select: { name: true, area: { select: { warehouseId: true } }, ...tableStateSelect(now, rules) },
      });
      const state = tableStatus(table, rules, now);
      if (state?.status === "Occupied") {
        return { ok: false, error: `${table.name} already has an open order. Close or move it before seating ${booking.guestName}.` };
      }
      if (state?.status === "Cleaning") {
        return { ok: false, error: `${table.name} still needs cleaning. Mark it clean on the floor plan first.` };
      }

      const order = await tx.order.create({
        data: {
          type: "DINE_IN",
          status: "OPEN",
          tableId: booking.tableId,
          warehouseId: table.area.warehouseId,
          customerId: booking.customerId,
          waiterId,
          guests: booking.partySize,
        },
        select: { id: true, number: true },
      });
      await tx.reservation.update({ where: { id }, data: { status: "SEATED", seatedAt: now, orderId: order.id } });
      return { ok: true, orderId: order.id, orderRef: orderRef(order.number) };
    });
  } catch (error) {
    // The one-open-order-per-table index caught an order opened meanwhile.
    if (isUniqueViolation(error, "activeTableId")) {
      return { ok: false, error: "That table already has an open order. Close or move it before seating this booking." };
    }
    throw error;
  }
}

// Booked → Cancelled.
export async function cancelBooking(id: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const booking = await lockReservation(tx, id);
    if (!booking || booking.status !== "BOOKED") return { ok: false, error: NOT_OPEN };
    await tx.reservation.update({ where: { id }, data: { status: "CANCELLED" } });
    return { ok: true };
  });
}

// Booked → No-show, once its time has passed.
export async function markBookingNoShow(id: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const booking = await lockReservation(tx, id);
    if (!booking || booking.status !== "BOOKED") return { ok: false, error: NOT_OPEN };
    if (booking.startsAt.getTime() > Date.now()) {
      return { ok: false, error: `It's not ${formatAppTime(booking.startsAt)} yet — a booking can only be a no-show once its time has passed.` };
    }
    await tx.reservation.update({ where: { id }, data: { status: "NO_SHOW" } });
    return { ok: true };
  });
}
