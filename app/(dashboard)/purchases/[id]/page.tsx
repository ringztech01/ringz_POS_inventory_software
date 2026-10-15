import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { getPurchaseDocument } from "../queries";

export default async function PurchaseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const { id } = await params;
  // Missing and soft-deleted purchases both 404.
  const purchase = await getPurchaseDocument(id);

  if (!purchase) {
    notFound();
  }

  return <PurchaseDetails purchase={purchase} />;
}
