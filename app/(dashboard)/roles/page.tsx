import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import RoleTable from "@/components/roles/RoleTable";
import { getRoleList } from "./queries";
import { deleteRole } from "./actions";

// Design: Records per page 10 / 25.
const PER_PAGE_OPTIONS = [10, 25];

// /roles — server-fetched; search (?q=, by name) and pagination run
// server-side. The access-control page itself: Manage Roles only.
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_ROLES);
  if (denied) return denied;

  const { q, page, perPage } = parseListParams(await searchParams, [], PER_PAGE_OPTIONS);
  const { roles, total } = await getRoleList({ q, page, perPage });

  return (
    <PurchaseListShell
      title="Roles"
      count={total}
      countNoun="role"
      subtitle="defined"
      createHref="/roles/create"
      createLabel="Create Role"
      page={page}
      perPage={perPage}
      perPageOptions={PER_PAGE_OPTIONS}
      showPageNumbers
      showFilters={false}
    >
      <RoleTable rows={roles} deleteAction={deleteRole} />
    </PurchaseListShell>
  );
}
