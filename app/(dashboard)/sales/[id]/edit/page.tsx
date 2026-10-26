import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveWarehouses, withCurrentOption } from "../../../purchases/queries";
import { getActiveCustomers, getSaleForEdit } from "../../queries";
import { searchProductsForSale, updateSale } from "../../actions";

export default async function EditSalePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE);
  if (denied) return denied;

  const [sale, warehouses, customers] = await Promise.all([getSaleForEdit(id), getActiveWarehouses(), getActiveCustomers()]);

  // Missing and soft-deleted sales both 404.
  if (!sale) {
    notFound();
  }

  return (
    <PurchaseForm
      mode="edit"
      noun="Sale"
      listHref="/sales"
      stockDirection="out"
      initial={sale.initial}
      warehouses={withCurrentOption(warehouses, sale.warehouse)}
      parties={withCurrentOption(
        customers.map(({ id: customerId, name }) => ({ id: customerId, name })),
        sale.party,
      )}
      partyLabel="Customer"
      partyField="customerId"
      priceField="price"
      unitLabel="Sale unit"
      // No paid-amount input on edit: payments are managed in Show Payments.
      takePayment={false}
      // Still warehouse-scoped: only products held in the selected warehouse.
      searchAction={searchProductsForSale}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updateSale.bind(null, sale.id)}
    />
  );
}
