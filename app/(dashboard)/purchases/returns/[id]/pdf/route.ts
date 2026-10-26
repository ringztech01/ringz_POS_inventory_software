import { PERMISSIONS } from "@/lib/permissions";
import { purchaseDocumentPdfResponse } from "@/lib/purchase-pdf";
import { PURCHASE_RETURN_COPY } from "@/components/purchases/purchase-display";
import { getPurchaseReturnDocument } from "../../queries";

// GET /purchases/returns/[id]/pdf — downloads the purchase return as a PDF
// (same generator as purchases).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return purchaseDocumentPdfResponse(() => getPurchaseReturnDocument(id), PURCHASE_RETURN_COPY, PERMISSIONS.MANAGE_PURCHASE_RETURN);
}
