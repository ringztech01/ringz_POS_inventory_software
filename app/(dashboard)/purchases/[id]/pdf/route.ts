import { PERMISSIONS } from "@/lib/permissions";
import { purchaseDocumentPdfResponse } from "@/lib/purchase-pdf";
import { PURCHASE_COPY } from "@/components/purchases/purchase-display";
import { getPurchaseDocument } from "../../queries";

// GET /purchases/[id]/pdf — downloads the purchase as a PDF.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return purchaseDocumentPdfResponse(() => getPurchaseDocument(id), PURCHASE_COPY, PERMISSIONS.MANAGE_PURCHASE);
}
