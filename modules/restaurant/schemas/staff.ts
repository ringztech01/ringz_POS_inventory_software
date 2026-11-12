import { z } from "zod";
import { STAFF_COLOURS } from "../lib/staffPins";
import { idSchema } from "./common";

// Settings › Staff (Part 6f Step 3).
const name = (what: string) => z.string().trim().min(1, `Enter the ${what}.`).max(50, `The ${what} is at most 50 characters.`);
// A PIN typed twice (checked against the rules in the service, where the
// "allow weak PINs" setting is known), or "generate one".
const pinChoice = z.union([
  z.object({ generate: z.literal(true) }),
  z.object({ pin: z.string().trim(), confirm: z.string().trim() }).refine((p) => p.pin === p.confirm, { message: "The two PINs don't match.", path: ["confirm"] }),
]);

const staffFields = {
  firstName: name("first name"),
  lastName: name("last name"),
  // Shown on tickets ("Ada O."); empty: made from the name.
  displayName: z.string().trim().max(40, "A display name is at most 40 characters.").optional().default(""),
  roleId: idSchema,
  colour: z.enum(STAFF_COLOURS).nullable().optional().default(null),
  homeAreaId: idSchema.nullable().optional().default(null),
  homeStation: z.string().trim().min(1).max(20).nullable().optional().default(null),
};

export const createStaffSchema = z.object({ ...staffFields, pin: pinChoice });
export const updateStaffSchema = z.object({ id: idSchema, ...staffFields });
export const setStaffPinSchema = z.object({ id: idSchema, pin: pinChoice });
export const disableStaffSchema = z.object({ id: idSchema, transferTo: idSchema.nullable().optional().default(null) });
export const enableStaffSchema = z.object({ id: idSchema });
export const staffSettingsSchema = z.object({ allowWeakPins: z.boolean(), staffSelfPin: z.boolean() });
export const ownPinSchema = z
  .object({ oldPin: z.string().trim(), pin: z.string().trim(), confirm: z.string().trim() })
  .refine((p) => p.pin === p.confirm, { message: "The two PINs don't match.", path: ["confirm"] });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type PinChoice = z.infer<typeof pinChoice>;
