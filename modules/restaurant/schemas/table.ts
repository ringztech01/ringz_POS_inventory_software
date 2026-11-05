import { z } from "zod";

export const TABLE_NAME_MAX = 20;
export const MAX_SEATS = 30;
const SEATS = `Seats must be a whole number from 1 to ${MAX_SEATS}.`;

// A dining table. Uniqueness (per area, among active tables) and the area
// being active are checked server-side, in the transaction.
export const tableSchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(TABLE_NAME_MAX, `Name can be at most ${TABLE_NAME_MAX} characters.`),
  seats: z.number({ message: SEATS }).int(SEATS).min(1, SEATS).max(MAX_SEATS, SEATS),
  areaId: z.string({ message: "Choose an area." }).trim().min(1, "Choose an area."),
});

export type TableInput = z.infer<typeof tableSchema>;
export type TableField = keyof TableInput;
