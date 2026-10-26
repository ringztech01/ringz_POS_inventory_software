import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses, getPurchaseForEdit, withCurrentOption } from "../../queries";
import { getPurchaseStockForProducts, searchProductsForPurchase, updatePurchase } from "../../actions";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE);
  if (denied) return denied;

  const [purchase, warehouses, suppliers] = await Promise.all([
    getPurchaseForEdit(id),
    getActiveWarehouses(),
    getActiveSuppliers(),
  ]);

  // Missing and soft-deleted purchases both 404.
  if (!purchase) {
    notFound();
  }

  return (
    <PurchaseForm
      mode="edit"
      noun="Purchase"
      listHref="/purchases"
      stockDirection="in"
      initial={purchase.initial}
      warehouses={withCurrentOption(warehouses, purchase.warehouse)}
      parties={withCurrentOption(suppliers, purchase.party)}
      searchAction={searchProductsForPurchase}
      stockAction={getPurchaseStockForProducts}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updatePurchase.bind(null, purchase.id)}
    />
  );
}
