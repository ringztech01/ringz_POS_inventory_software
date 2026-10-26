import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseTable from "@/components/purchases/PurchaseTable";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import { getActiveWarehouses } from "../purchases/queries";
import { getSaleList } from "./queries";
import { deleteSale } from "./actions";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();
  const { q, from, to, page, perPage, selectedWarehouse } = parseListParams(await searchParams, warehouses);

  // Cross-module item: shown only with Manage Sale Return (UX; the return
  // pages and actions enforce it).
  const canCreateReturn = await can(PERMISSIONS.MANAGE_SALE_RETURN);

  const { sales, total, totals } = await getSaleList({
    q,
    from,
    to,
    warehouseId: selectedWarehouse?.id,
    page,
    perPage,
  });

  return (
    <PurchaseListShell
      title="Sales"
      count={total}
      countNoun="sale"
      selectedWarehouse={selectedWarehouse}
      createHref="/sales/create"
      createLabel="Create Sale"
      warehouses={warehouses}
      page={page}
      perPage={perPage}
      showPageNumbers
    >
      <PurchaseTable
        rows={sales}
        basePath="/sales"
        noun="Sale"
        layout="sale"
        partyLabel="Customer"
        stockEffect="out"
        movedStockLabel="sold"
        deleteNote="Its payments are removed too."
        deleteAction={deleteSale}
        totals={totals}
        emptyMessage="No sales found."
        rowExtraItems={(row) => [
          { label: "Show Payments", icon: "circle-dollar-sign", modal: "payments" },
          ...(canCreateReturn
            ? [{ label: "Create Sale Return", icon: "shopping-cart" as const, href: `/sales/returns/create?saleId=${row.id}` }]
            : []),
        ]}
      />
    </PurchaseListShell>
  );
}
