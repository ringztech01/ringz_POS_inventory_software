"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { reservationSchema } from "../../schemas/reservation";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import {
  bookTable,
  cancelBooking,
  markBookingNoShow,
  NOT_OPEN,
  seatBooking,
  type BookingResult,
  type SeatResult,
} from "../services/reservations";

// Thin wrappers: permission, input parsing and refresh here; the rules are in
// services/reservations.ts.

const requireManageReservations = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_RESERVATIONS);
const refresh = () => revalidatePath("/restaurant", "layout");

export async function createReservation(input: unknown): Promise<BookingResult> {
  return safely("create reservation", async (): Promise<BookingResult> => {
    const authCheck = await requireManageReservations();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = reservationSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await bookTable(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// Seat a Booked party: opens its table's order and links the two.
export async function seatReservation(id: unknown): Promise<SeatResult> {
  return safely("seat reservation", async (): Promise<SeatResult> => {
    const authCheck = await requireManageReservations();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: NOT_OPEN };

    const result = await seatBooking(parsedId.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function cancelReservation(id: unknown): Promise<ActionResult> {
  return safely("cancel reservation", async (): Promise<ActionResult> => {
    const authCheck = await requireManageReservations();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: NOT_OPEN };

    const result = await cancelBooking(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}

export async function markReservationNoShow(id: unknown): Promise<ActionResult> {
  return safely("mark reservation no-show", async (): Promise<ActionResult> => {
    const authCheck = await requireManageReservations();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: NOT_OPEN };

    const result = await markBookingNoShow(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}
