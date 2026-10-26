import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { SALE_RETURN_STATUS_OPTIONS } from "@/components/purchases/purchase-display";
import { getSaleReturnForEdit } from "../../queries";
import { updateSaleReturn } from "../../actions";

// /sales/returns/[id]/edit — same form as create, pre-filled with the
// return's lines. Each line's cap is what the sale still has returnable with
// this return left out; customer and warehouse stay read-only.
export default async function EditSaleReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE_RETURN);
  if (denied) return denied;

  // Missing and soft-deleted returns both 404.
  const saleReturn = await getSaleReturnForEdit(id);
  if (!saleReturn) {
    notFound();
  }

  return (
    <PurchaseForm
      mode="edit"
      noun="Sale Return"
      listHref="/sales/returns"
      stockDirection="in"
      warehouses={[]}
      parties={[]}
      partyLabel="Customer"
      partyField="customerId"
      priceField="price"
      unitLabel="Sale unit"
      statusOptions={SALE_RETURN_STATUS_OPTIONS}
      fromDocument={{
        id: saleReturn.sale.id,
        referenceLabel: "Sale reference",
        reference: saleReturn.sale.reference,
        partyName: saleReturn.sale.customerName,
        warehouseName: saleReturn.sale.warehouseName,
      }}
      initial={saleReturn.initial}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updateSaleReturn.bind(null, saleReturn.id)}
    />
  );
}
