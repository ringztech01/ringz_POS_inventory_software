import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { getActiveRoles } from "@/app/(dashboard)/roles/queries";
import { createUser } from "../actions";

export default async function CreateUserPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_USERS);
  if (denied) return denied;

  const roles = await getActiveRoles();

  return <UserForm roles={roles} action={createUser} />;
}
