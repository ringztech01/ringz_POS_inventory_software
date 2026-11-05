import { z } from "zod";

export const GROUP_NAME_MAX = 40;
export const MAX_SELECTIONS = 10;

// A modifier group (Food › Modifiers). Its choices are minSelect / maxSelect
// (the spec's minSelections / maxSelections); "required" isn't stored — a
// group is required when its minimum is at least 1 — so the form's Required
// switch must agree with the minimum. Name uniqueness is checked server-side.
export const modifierGroupSchema = z
  .object({
    name: z
      .string({ message: "Name is required." })
      .trim()
      .min(1, "Name is required.")
      .max(GROUP_NAME_MAX, `Name can be at most ${GROUP_NAME_MAX} characters.`),
    minSelect: z.coerce.number({ message: "Enter a number." }).int("Whole numbers only.").min(0, "0 or more.").max(MAX_SELECTIONS, `At most ${MAX_SELECTIONS}.`),
    maxSelect: z.coerce.number({ message: "Enter a number." }).int("Whole numbers only.").min(1, "At least 1.").max(MAX_SELECTIONS, `At most ${MAX_SELECTIONS}.`),
    required: z.boolean(),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "The minimum can't be more than the maximum.", path: ["minSelect"] })
  .refine((g) => !g.required || g.minSelect >= 1, { message: "A required group needs a minimum of at least 1.", path: ["minSelect"] })
  .refine((g) => g.required || g.minSelect === 0, { message: "An optional group has a minimum of 0 — or switch on Required.", path: ["minSelect"] });

export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;
export type ModifierGroupField = keyof z.input<typeof modifierGroupSchema>;
