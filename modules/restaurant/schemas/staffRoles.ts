import { z } from "zod";
import { ACCESS_LEVELS, HOME_SCREENS, type AccessLevel, type HomeScreen } from "../lib/staffRoles";
import { idSchema } from "./common";

// Part 6f Step 2: the role matrix's save (every role changed, as it should
// now be) and Copy role.
export const ROLE_NAME_MAX = 50;

export const roleRowSchema = z.object({
  id: idSchema,
  permissions: z.array(z.string().min(1).max(80)).max(200),
  accessLevel: z.enum(ACCESS_LEVELS as [AccessLevel, ...AccessLevel[]]),
  homeScreen: z.enum(HOME_SCREENS as [HomeScreen, ...HomeScreen[]]),
  homeAreaId: idSchema.nullable(),
  homeStation: z.string().trim().min(1).max(20).nullable(),
});
export const roleMatrixSchema = z.object({ roles: z.array(roleRowSchema).min(1).max(100) });
export type RoleMatrixInput = z.infer<typeof roleMatrixSchema>;

export const copyRoleSchema = z.object({
  fromId: idSchema,
  name: z.string().trim().min(1, "Give the new role a name.").max(ROLE_NAME_MAX, `A role name is at most ${ROLE_NAME_MAX} characters.`),
});
export type CopyRoleInput = z.infer<typeof copyRoleSchema>;
