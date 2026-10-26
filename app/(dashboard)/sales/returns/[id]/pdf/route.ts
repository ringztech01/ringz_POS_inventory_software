import { PERMISSIONS } from "@/lib/permissions";
import { purchaseDocumentPdfResponse } from "@/lib/purchase-pdf";
import { SALE_RETURN_COPY } from "@/components/purchases/purchase-display";
import { getSaleReturnDocument } from "../../queries";

// GET /sales/returns/[id]/pdf — the return as a credit note PDF (shared
// generator), with its refunds.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return purchaseDocumentPdfResponse(() => getSaleReturnDocument(id), SALE_RETURN_COPY, PERMISSIONS.MANAGE_SALE_RETURN);
}
