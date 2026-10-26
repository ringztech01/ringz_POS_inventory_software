import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { PURCHASE_COPY } from "@/components/purchases/purchase-display";
import { getPurchaseDocument } from "../queries";

export default async function PurchaseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PURCHASE);
  if (denied) return denied;

  const { id } = await params;
  // Missing and soft-deleted purchases both 404.
  const purchase = await getPurchaseDocument(id);

  if (!purchase) {
    notFound();
  }

  return <PurchaseDetails purchase={purchase} copy={PURCHASE_COPY} />;
}
