import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { getActiveRoles } from "@/app/(dashboard)/roles/queries";
import { getUserById } from "../../queries";
import { updateUser } from "../../actions";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_USERS);
  if (denied) return denied;

  const { id } = await params;
  const [user, roles] = await Promise.all([getUserById(id), getActiveRoles()]);

  if (!user) {
    notFound();
  }

  return <UserForm user={user} roles={roles} action={updateUser.bind(null, user.id)} />;
}
