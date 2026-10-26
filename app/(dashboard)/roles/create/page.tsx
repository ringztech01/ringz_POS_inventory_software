import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import RoleForm from "@/components/roles/RoleForm";
import { createRole } from "../actions";

// /roles/create — the design's create view.
export default async function CreateRolePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_ROLES);
  if (denied) return denied;

  return <RoleForm saveAction={createRole} />;
}
