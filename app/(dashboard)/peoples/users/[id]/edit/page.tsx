import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { isSystemAdmin } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { restaurantModule } from "@/modules/restaurant/manifest";
import { PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { getAssignableRoles } from "@/app/(dashboard)/roles/queries";
import { getUserById } from "../../queries";
import { updateUser } from "../../actions";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_USERS);
  if (denied) return denied;
  // Part 6f: with the Restaurant module on, users are the Administrator's.
  if ((await isModuleEnabled(restaurantModule.id)) && !(await isSystemAdmin())) return <ForbiddenState permission="Administrator role" />;

  const { id } = await params;
  const user = await getUserById(id);
  const roles = user ? await getAssignableRoles(user.roleId ?? null) : [];

  if (!user) {
    notFound();
  }

  return <UserForm user={user} roles={roles} action={updateUser.bind(null, user.id)} />;
}
