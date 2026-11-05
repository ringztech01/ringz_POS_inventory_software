import { z } from "zod";

export const STATION_NAME_MAX = 40;
export const LATE_AFTER_MAX = 180;

// A kitchen station (Stations settings). Code uniqueness is checked
// server-side, in the transaction.
export const stationSchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(STATION_NAME_MAX, `Name can be at most ${STATION_NAME_MAX} characters.`),
  code: z
    .string({ message: "Code is required." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "Use 2–6 letters, e.g. KIT or BAR."),
  lateAfterMin: z.coerce
    .number({ message: "Enter the minutes." })
    .int("Whole minutes only.")
    .min(1, "At least 1 minute.")
    .max(LATE_AFTER_MAX, `At most ${LATE_AFTER_MAX} minutes.`),
  sortOrder: z.coerce.number({ message: "Enter a number." }).int("Whole numbers only.").min(0, "0 or more.").max(999, "At most 999."),
  isActive: z.boolean(),
});

export type StationInput = z.infer<typeof stationSchema>;
export type StationField = keyof StationInput;
