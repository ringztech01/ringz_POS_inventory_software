import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import UserForm from "@/components/users/UserForm";
import { createUser } from "../actions";

export default async function CreateUserPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_USERS)) {
    redirect("/peoples/users");
  }

  return <UserForm action={createUser} />;
}
