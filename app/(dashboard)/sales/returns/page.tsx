import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseTable from "@/components/purchases/PurchaseTable";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import { getActiveWarehouses } from "../../purchases/queries";
import { getSaleReturnList } from "./queries";
import { deleteSaleReturn } from "./actions";

// A static segment: Next matches /sales/returns here before /sales/[id], so
// "returns" is never treated as a sale id. No Create button — a return is
// always started from a sale (Sales list → Create Sale Return).
export default async function SaleReturnsPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE_RETURN);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();
  const { q, from, to, page, perPage, selectedWarehouse } = parseListParams(await searchParams, warehouses);

  const { saleReturns, total } = await getSaleReturnList({
    q,
    from,
    to,
    warehouseId: selectedWarehouse?.id,
    page,
    perPage,
  });

  return (
    <PurchaseListShell
      title="Sales Returns"
      count={total}
      countNoun="sale return"
      selectedWarehouse={selectedWarehouse}
      warehouses={warehouses}
      page={page}
      perPage={perPage}
      showPageNumbers
    >
      <PurchaseTable
        rows={saleReturns}
        basePath="/sales/returns"
        noun="Sale Return"
        layout="saleReturn"
        partyLabel="Customer"
        // A received return put stock back in; deleting it takes it out.
        stockEffect="in"
        deleteNote="Its refunds are removed too."
        emptyMessage="No sale returns found."
        deleteAction={deleteSaleReturn}
      />
    </PurchaseListShell>
  );
}
