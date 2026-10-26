import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { TRANSFER_STATUS_OPTIONS } from "@/components/purchases/purchase-display";
import { TRANSFER_UNITS } from "@/lib/purchase-units";
import { getActiveWarehouses, withCurrentOption } from "../../../purchases/queries";
import { getTransferForEdit } from "../../queries";
import { searchProductsForTransfer, updateTransfer } from "../../actions";

// /transfers/[id]/edit — the create form pre-filled. Search stays scoped to
// the current From; existing lines are capped at From stock + this
// transfer's own qty (when it was Completed).
export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  const denied = await pageGuard(PERMISSIONS.MANAGE_TRANSFERS);
  if (denied) return denied;

  const [transfer, warehouses] = await Promise.all([getTransferForEdit(id), getActiveWarehouses()]);

  // Missing and soft-deleted transfers both 404.
  if (!transfer) {
    notFound();
  }

  return (
    <PurchaseForm
      mode="edit"
      transfer
      noun="Transfer"
      listHref="/transfers"
      stockDirection="out"
      initial={transfer.initial}
      // The transfer's own From/To stay selectable even if since soft-deleted.
      warehouses={withCurrentOption(withCurrentOption(warehouses, transfer.warehouse), transfer.toWarehouse)}
      parties={[]}
      unitLabel="Transfer unit"
      units={TRANSFER_UNITS}
      defaultUnit="Piece"
      statusOptions={TRANSFER_STATUS_OPTIONS}
      searchAction={searchProductsForTransfer}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updateTransfer.bind(null, transfer.id)}
    />
  );
}
