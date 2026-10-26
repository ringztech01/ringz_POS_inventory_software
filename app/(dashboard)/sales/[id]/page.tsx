import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { SALE_COPY } from "@/components/purchases/purchase-display";
import { getSaleDocument } from "../queries";

// The Sale Details view, on the shared document details layout.
export default async function SaleDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE);
  if (denied) return denied;

  const { id } = await params;
  // Missing and soft-deleted sales both 404.
  const sale = await getSaleDocument(id);

  if (!sale) {
    notFound();
  }

  return <PurchaseDetails purchase={sale} copy={SALE_COPY} />;
}
