import { z } from "zod";
import { DAY_START_CHOICES } from "../lib/reportTabs";

// Restaurant Reports' setting: when the business day starts (minutes after
// midnight, 00:00 to 06:00 every 30).
export const dayStartSchema = z.object({
  minutes: z.number().refine((n) => DAY_START_CHOICES.includes(n), "Pick one of the times."),
});
export type DayStartInput = z.output<typeof dayStartSchema>;

// Restaurant › Touch POS › Reports: the business day and the cash variance
// limit (₦, a cash-up over or short by more shows red), saved together.
export const reportSettingsSchema = dayStartSchema.extend({
  varianceLimit: z
    .string({ message: "Enter the limit." })
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 500 or 1250.50."),
});
export type ReportSettingsInput = z.output<typeof reportSettingsSchema>;
