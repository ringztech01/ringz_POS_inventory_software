import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses } from "../queries";
import { createPurchase, getPurchaseStockForProducts, searchProductsForPurchase } from "../actions";

export default async function CreatePurchasePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE);
  if (denied) return denied;

  const [warehouses, suppliers] = await Promise.all([getActiveWarehouses(), getActiveSuppliers()]);

  return (
    <PurchaseForm
      noun="Purchase"
      listHref="/purchases"
      stockDirection="in"
      warehouses={warehouses}
      parties={suppliers}
      searchAction={searchProductsForPurchase}
      stockAction={getPurchaseStockForProducts}
      saveAction={createPurchase}
    />
  );
}
