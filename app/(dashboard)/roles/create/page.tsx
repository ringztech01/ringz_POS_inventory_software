import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionGroups } from "@/lib/permissions";
import { getEnabledModuleIds } from "@/lib/modules/enabled.server";
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

  return <RoleForm groups={permissionGroups(await getEnabledModuleIds())} saveAction={createRole} />;
}
