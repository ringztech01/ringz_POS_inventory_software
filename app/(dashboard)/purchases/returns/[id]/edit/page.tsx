import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses, withCurrentOption } from "../../../queries";
import { getPurchaseReturnForEdit } from "../../queries";
import { searchProductsForReturn, updatePurchaseReturn } from "../../actions";

export default async function EditPurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE_RETURN);
  if (denied) return denied;

  const [purchaseReturn, warehouses, suppliers] = await Promise.all([
    getPurchaseReturnForEdit(id),
    getActiveWarehouses(),
    getActiveSuppliers(),
  ]);

  // Missing and soft-deleted returns both 404.
  if (!purchaseReturn) {
    notFound();
  }

  return (
    <PurchaseForm
      mode="edit"
      noun="Purchase Return"
      listHref="/purchases/returns"
      stockDirection="out"
      initial={purchaseReturn.initial}
      warehouses={withCurrentOption(warehouses, purchaseReturn.warehouse)}
      parties={withCurrentOption(suppliers, purchaseReturn.party)}
      // Still warehouse-scoped: only products held in the selected warehouse.
      searchAction={searchProductsForReturn}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updatePurchaseReturn.bind(null, purchaseReturn.id)}
    />
  );
}
