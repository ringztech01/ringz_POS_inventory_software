import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { requireRestaurant } from "../server/guard";
import { getRoleMatrix } from "../server/services/staffRoles";
import RoleMatrix from "../components/settings/RoleMatrix";

// /settings/restaurant/roles — Settings › Restaurant › Roles (Part 6f Step
// 2): the permission matrix — every role's permissions, access level and
// home screen; Copy role. Administrator only (the built-in role, not a
// permission); a 404 while the module is off.
export default async function RoleMatrixPage() {
  await requireRestaurant();
  if (!(await isSystemAdmin(await getCurrentUserPermissions()))) return <ForbiddenState permission="Administrator role" />;
  return <RoleMatrix data={await getRoleMatrix()} />;
}
