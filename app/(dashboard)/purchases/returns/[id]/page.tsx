import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { PURCHASE_RETURN_COPY } from "@/components/purchases/purchase-display";
import { getPurchaseReturnDocument } from "../queries";

// Reuses the Purchase Details layout.
export default async function PurchaseReturnDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE_RETURN);
  if (denied) return denied;

  const { id } = await params;
  // Missing and soft-deleted returns both 404.
  const purchaseReturn = await getPurchaseReturnDocument(id);

  if (!purchaseReturn) {
    notFound();
  }

  return <PurchaseDetails purchase={purchaseReturn} copy={PURCHASE_RETURN_COPY} />;
}
