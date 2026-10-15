import { auth } from "@/auth";
import { renderPurchasePdf } from "@/lib/purchase-pdf";
import { getPurchaseDocument } from "../../queries";

// GET /purchases/[id]/pdf — downloads the purchase as a PDF. Route handlers
// don't go through the dashboard layout's auth check, so it's done here.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  // Missing and soft-deleted purchases both 404, like the details page.
  const purchase = await getPurchaseDocument(id);
  if (!purchase) {
    return new Response("Purchase not found", { status: 404 });
  }

  const bytes = await renderPurchasePdf(purchase);

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${purchase.reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
