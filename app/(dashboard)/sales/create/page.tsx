import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveWarehouses } from "../../purchases/queries";
import { getActiveCustomers } from "../queries";
import { createSale, searchProductsForSale } from "../actions";

export default async function CreateSalePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE);
  if (denied) return denied;

  const [warehouses, customers] = await Promise.all([getActiveWarehouses(), getActiveCustomers()]);

  return (
    <PurchaseForm
      noun="Sale"
      listHref="/sales"
      stockDirection="out"
      warehouses={warehouses}
      parties={customers.map(({ id, name }) => ({ id, name }))}
      partyLabel="Customer"
      partyField="customerId"
      // The protected walk-in ("direct-customer") is the default.
      defaultPartyId={customers.find((customer) => customer.isDefault)?.id ?? ""}
      priceField="price"
      unitLabel="Sale unit"
      takePayment
      searchAction={searchProductsForSale}
      saveAction={createSale}
    />
  );
}
