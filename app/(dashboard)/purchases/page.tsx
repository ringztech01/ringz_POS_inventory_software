import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseTable from "@/components/purchases/PurchaseTable";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import { getActiveWarehouses, getPurchaseList } from "./queries";
import { deletePurchase } from "./actions";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();
  const { q, from, to, page, perPage, selectedWarehouse } = parseListParams(await searchParams, warehouses);

  const { purchases, total, grandTotalSum } = await getPurchaseList({
    q,
    from,
    to,
    warehouseId: selectedWarehouse?.id,
    page,
    perPage,
  });

  return (
    <PurchaseListShell
      title="Purchases"
      count={total}
      countNoun="purchase order"
      selectedWarehouse={selectedWarehouse}
      createHref="/purchases/create"
      createLabel="Create Purchase"
      warehouses={warehouses}
      page={page}
      perPage={perPage}
    >
      <PurchaseTable
        rows={purchases}
        basePath="/purchases"
        noun="Purchase"
        stockEffect="in"
        totals={{ grandTotal: grandTotalSum }}
        emptyMessage="No purchases found."
        deleteAction={deletePurchase}
      />
    </PurchaseListShell>
  );
}
