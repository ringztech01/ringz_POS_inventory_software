import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { can } from "@/lib/auth/permissions.server";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { SALE_RETURN_COPY } from "@/components/purchases/purchase-display";
import RecordRefundButton from "@/components/sales/RecordRefundButton";
import { getSaleReturnDocument } from "../queries";

// The Sale Return Details view, on the shared document details layout, with
// "Record refund" (the shared payments modal, backed by SaleReturnPayment).
export default async function SaleReturnDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE_RETURN);
  if (denied) return denied;

  const { id } = await params;
  // Missing and soft-deleted returns both 404.
  const saleReturn = await getSaleReturnDocument(id);

  if (!saleReturn) {
    notFound();
  }

  // The refund actions re-check the permission; the button is only offered
  // to those who have it.
  const canManage = await can(PERMISSIONS.MANAGE_SALE_RETURN);

  return (
    <PurchaseDetails
      purchase={saleReturn}
      copy={SALE_RETURN_COPY}
      actions={canManage ? <RecordRefundButton saleReturnId={saleReturn.id} /> : undefined}
    />
  );
}
