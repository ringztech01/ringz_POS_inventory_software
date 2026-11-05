import { z } from "zod";
import { idSchema } from "./common";

export const MODIFIER_NAME_MAX = 40;

// A modifier in a group (Food › Modifiers › Modifiers). Its price change is
// added to the dish's price when chosen (the spec's priceChange is the
// existing Modifier.price); it may be negative ("No rice −₦2"). Name
// uniqueness within the group is checked server-side.
export const modifierSchema = z.object({
  groupId: idSchema,
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(MODIFIER_NAME_MAX, `Name can be at most ${MODIFIER_NAME_MAX} characters.`),
  price: z
    .string()
    .trim()
    .transform((value) => value || "0")
    .pipe(z.string().regex(/^-?\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 2, 2.50 or -1.")),
});

export type ModifierInput = z.infer<typeof modifierSchema>;
export type ModifierField = keyof z.input<typeof modifierSchema>;

// The ↑ / ↓ rank buttons.
export const moveModifierSchema = z.object({ id: idSchema, direction: z.enum(["up", "down"]) });
