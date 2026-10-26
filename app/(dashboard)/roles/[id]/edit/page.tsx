import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import RoleForm from "@/components/roles/RoleForm";
import { getRoleForEdit } from "../../queries";
import { updateRole } from "../../actions";

// /roles/[id]/edit — the create form pre-filled with the name and checked
// set. Missing or soft-deleted roles 404.
export default async function EditRolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_ROLES);
  if (denied) return denied;

  const { id } = await params;
  const role = await getRoleForEdit(id);
  if (!role) {
    notFound();
  }

  return (
    <RoleForm
      mode="edit"
      initial={role.initial}
      locked={role.isSystem}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updateRole.bind(null, role.id)}
    />
  );
}
