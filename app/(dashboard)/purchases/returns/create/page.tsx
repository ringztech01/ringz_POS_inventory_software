import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses } from "../../queries";
import { createPurchaseReturn, searchProductsForReturn } from "../actions";

export default async function CreatePurchaseReturnPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE_RETURN);
  if (denied) return denied;

  const [warehouses, suppliers] = await Promise.all([getActiveWarehouses(), getActiveSuppliers()]);

  return (
    <PurchaseForm
      noun="Purchase Return"
      listHref="/purchases/returns"
      stockDirection="out"
      warehouses={warehouses}
      parties={suppliers}
      searchAction={searchProductsForReturn}
      saveAction={createPurchaseReturn}
    />
  );
}
