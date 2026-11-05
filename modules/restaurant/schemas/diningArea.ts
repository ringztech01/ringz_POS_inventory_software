import { z } from "zod";

export const AREA_NAME_MAX = 60;

// A dining area. Uniqueness (per warehouse, among active areas) and the
// warehouse being active are checked server-side, in the transaction.
export const diningAreaSchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(AREA_NAME_MAX, `Name can be at most ${AREA_NAME_MAX} characters.`),
  warehouseId: z.string({ message: "Choose a warehouse." }).trim().min(1, "Choose a warehouse."),
});

export type DiningAreaInput = z.infer<typeof diningAreaSchema>;
export type DiningAreaField = keyof DiningAreaInput;
