import { z } from "zod";
import { isCalendarDay } from "../lib/time";
import { MAX_SEATS } from "./table";

export const GUEST_NAME_MAX = 80;
export const GUEST_PHONE_MAX = 30;
const PARTY = `Party size must be a whole number from 1 to ${MAX_SEATS}.`;

// A new booking. Either an existing customer (the server copies their name
// and phone) or a typed name and phone. Not-in-the-past, the table fitting
// the party and the double-booking rule are checked on the server.
const guest = z.object({
  customerId: z.string().trim().max(191).optional().default(""),
  guestName: z.string().trim().max(GUEST_NAME_MAX, `Name can be at most ${GUEST_NAME_MAX} characters.`).optional().default(""),
  guestPhone: z.string().trim().max(GUEST_PHONE_MAX, "Enter a valid phone number.").optional().default(""),
});

const validPhone = (phone: string) => /^\+?[\d\s()-]{7,}$/.test(phone) && phone.replace(/\D/g, "").length >= 7;

// The guest checks run whenever the guest fields themselves are well-formed
// (`when`), so they're reported together with any other field's error
// instead of only after everything else is fixed.
const guestOk = { when: (payload: { value: unknown }) => guest.safeParse(payload.value).success };

export const reservationSchema = guest
  .extend({
    partySize: z.number({ message: PARTY }).int(PARTY).min(1, PARTY).max(MAX_SEATS, PARTY),
    date: z.string({ message: "Pick a date." }).refine(isCalendarDay, "Pick a date."),
    time: z.string({ message: "Pick a time." }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time."),
    tableId: z.string({ message: "Choose a table." }).trim().min(1, "Choose a table."),
  })
  .refine((v) => !!v.customerId || !!v.guestName, {
    path: ["guestName"],
    message: "Enter the guest's name, or pick a customer.",
    ...guestOk,
  })
  .refine((v) => !!v.customerId || !!v.guestPhone, { path: ["guestPhone"], message: "Enter a phone number.", ...guestOk })
  .refine((v) => !!v.customerId || !v.guestPhone || validPhone(v.guestPhone), {
    path: ["guestPhone"],
    message: "Enter a valid phone number.",
    ...guestOk,
  });

export type ReservationInput = z.infer<typeof reservationSchema>;
export type ReservationField = keyof ReservationInput;
