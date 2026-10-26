import { PERMISSIONS } from "@/lib/permissions";
import { purchaseDocumentPdfResponse } from "@/lib/purchase-pdf";
import { SALE_COPY } from "@/components/purchases/purchase-display";
import { getSaleDocument } from "../../queries";

// GET /sales/[id]/pdf — the sale as an invoice PDF (shared generator).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return purchaseDocumentPdfResponse(() => getSaleDocument(id), SALE_COPY, PERMISSIONS.MANAGE_SALE);
}
