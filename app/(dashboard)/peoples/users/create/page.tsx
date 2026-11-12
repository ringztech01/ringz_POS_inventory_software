import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { isSystemAdmin } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { restaurantModule } from "@/modules/restaurant/manifest";
import { PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { getAssignableRoles } from "@/app/(dashboard)/roles/queries";
import { createUser } from "../actions";

export default async function CreateUserPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_USERS);
  if (denied) return denied;
  // Part 6f: with the Restaurant module on, users are the Administrator's.
  if ((await isModuleEnabled(restaurantModule.id)) && !(await isSystemAdmin())) return <ForbiddenState permission="Administrator role" />;

  const roles = await getAssignableRoles();

  return <UserForm roles={roles} action={createUser} />;
}
