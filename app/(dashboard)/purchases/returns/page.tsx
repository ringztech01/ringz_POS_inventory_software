import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseTable from "@/components/purchases/PurchaseTable";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import { getActiveWarehouses } from "../queries";
import { getPurchaseReturnList } from "./queries";
import { deletePurchaseReturn } from "./actions";

// A static segment: Next matches /purchases/returns here before it would try
// /purchases/[id], so "returns" is never treated as a purchase id.
export default async function PurchaseReturnsPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE_RETURN);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();
  const { q, from, to, page, perPage, selectedWarehouse } = parseListParams(await searchParams, warehouses);

  const { returns, total } = await getPurchaseReturnList({
    q,
    from,
    to,
    warehouseId: selectedWarehouse?.id,
    page,
    perPage,
  });

  return (
    <PurchaseListShell
      title="Purchases Returns"
      count={total}
      countNoun="purchase return"
      selectedWarehouse={selectedWarehouse}
      createHref="/purchases/returns/create"
      createLabel="Create Purchase Return"
      warehouses={warehouses}
      page={page}
      perPage={perPage}
    >
      <PurchaseTable
        rows={returns}
        basePath="/purchases/returns"
        noun="Purchase Return"
        stockEffect="out"
        layout="purchaseReturn"
        emptyMessage="No purchase returns found."
        deleteAction={deletePurchaseReturn}
      />
    </PurchaseListShell>
  );
}
