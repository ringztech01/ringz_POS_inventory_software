import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { getUserById } from "../../queries";
import { updateUser } from "../../actions";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_USERS)) {
    redirect("/peoples/users");
  }

  const { id } = await params;
  const user = await getUserById(id);

  if (!user) {
    notFound();
  }

  return <UserForm user={user} action={updateUser.bind(null, user.id)} />;
}
