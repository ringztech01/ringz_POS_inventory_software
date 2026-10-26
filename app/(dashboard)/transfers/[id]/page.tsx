import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { can } from "@/lib/auth/permissions.server";
import GhostButton from "@/components/ui/GhostButton";
import PurchaseDetails from "@/components/purchases/PurchaseDetails";
import { TRANSFER_COPY } from "@/components/purchases/purchase-display";
import { getTransferDocument } from "../queries";

// Transfer Details — the read-only view archetype (Purchase Details layout):
// From/To warehouse cards, transfer info, items and totals; no payment.
export default async function TransferDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_TRANSFERS);
  if (denied) return denied;

  const { id } = await params;
  // Missing and soft-deleted transfers both 404.
  const transfer = await getTransferDocument(id);

  if (!transfer) {
    notFound();
  }

  const [from, to] = transfer.contactCards ?? [];

  return (
    <PurchaseDetails
      purchase={transfer}
      copy={TRANSFER_COPY}
      subtitle={`${from?.name} → ${to?.name}`}
      actions={
        (await can(PERMISSIONS.MANAGE_TRANSFERS)) ? (
          <GhostButton href={`/transfers/${transfer.id}/edit`} paddingX={18}>
            <Pencil size={14} strokeWidth={1.7} />
            Edit
          </GhostButton>
        ) : undefined
      }
    />
  );
}
