import { z } from "zod";
import { PERMISSIONS } from "@/lib/permissions";

export const ROLE_NAME_MAX = 191;

export const roleSchema = z.object({
  // Uniqueness among active roles is checked server-side (a field error).
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(ROLE_NAME_MAX, `Name can be at most ${ROLE_NAME_MAX} characters.`),
  // Only the canonical strings; duplicates collapse. A role may have none
  // (e.g. a cashier role that only signs in). "All Permissions" is a UI
  // toggle and is never sent or stored.
  permissions: z
    .array(z.enum(PERMISSIONS, { message: "Unknown permission." }), { message: "Choose permissions." })
    .transform((list) => [...new Set(list)]),
});

export type RoleInput = z.infer<typeof roleSchema>;
