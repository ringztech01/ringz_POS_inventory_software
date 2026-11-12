import { z } from "zod";
import { DAY_START_CHOICES } from "../lib/reportTabs";

// Restaurant Reports' setting: when the business day starts (minutes after
// midnight, 00:00 to 06:00 every 30).
export const dayStartSchema = z.object({
  minutes: z.number().refine((n) => DAY_START_CHOICES.includes(n), "Pick one of the times."),
});
export type DayStartInput = z.output<typeof dayStartSchema>;
