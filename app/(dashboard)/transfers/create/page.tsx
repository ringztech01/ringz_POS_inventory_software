import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { TRANSFER_STATUS_OPTIONS } from "@/components/purchases/purchase-display";
import { TRANSFER_UNITS } from "@/lib/purchase-units";
import { getActiveWarehouses } from "../../purchases/queries";
import { createTransfer, searchProductsForTransfer } from "../actions";

// /transfers/create — the shared document form in transfer mode: From and To
// warehouses (loaded from the Warehouse table), no party or payment.
export default async function CreateTransferPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_TRANSFERS);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();

  return (
    <PurchaseForm
      transfer
      noun="Transfer"
      listHref="/transfers"
      // Lines leave the From warehouse: search is scoped to it and quantities
      // are capped at its stock.
      stockDirection="out"
      warehouses={warehouses}
      parties={[]}
      unitLabel="Transfer unit"
      units={TRANSFER_UNITS}
      defaultUnit="Piece"
      // Default Completed (design order).
      statusOptions={TRANSFER_STATUS_OPTIONS}
      searchAction={searchProductsForTransfer}
      saveAction={createTransfer}
    />
  );
}
