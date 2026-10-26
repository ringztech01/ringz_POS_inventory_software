import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import TransferTable from "@/components/transfers/TransferTable";
import { getTransferList } from "./queries";
import { deleteTransfer } from "./actions";

// /transfers — search (reference or either warehouse's name), date range and
// pagination all run server-side from searchParams.
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_TRANSFERS);
  if (denied) return denied;

  const { q, from, to, page, perPage } = parseListParams(await searchParams, []);
  const { transfers, total } = await getTransferList({ q, from, to, page, perPage });

  return (
    <PurchaseListShell
      title="Transfers"
      count={total}
      countNoun="transfer"
      subtitle="between warehouses"
      createHref="/transfers/create"
      createLabel="Create Transfer"
      page={page}
      perPage={perPage}
      showPageNumbers
    >
      <TransferTable rows={transfers} deleteAction={deleteTransfer} />
    </PurchaseListShell>
  );
}
