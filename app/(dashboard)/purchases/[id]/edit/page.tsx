import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses, getPurchaseForEdit } from "../../queries";
import type { FormOption } from "../../types";

// Keeps the purchase's own warehouse/supplier selectable even if it has
// since been soft-deleted (it's then missing from the active list).
function withCurrent(options: FormOption[], current: FormOption): FormOption[] {
  return options.some((option) => option.id === current.id) ? options : [...options, current];
}

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_PURCHASES)) {
    redirect(`/purchases/${id}`);
  }

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
      purchaseId={purchase.id}
      initial={purchase.initial}
      warehouses={withCurrent(warehouses, purchase.warehouse)}
      suppliers={withCurrent(suppliers, purchase.supplier)}
    />
  );
}
