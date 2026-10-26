import { notFound, redirect } from "next/navigation";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { SALE_RETURN_STATUS_OPTIONS } from "@/components/purchases/purchase-display";
import { getSaleForReturn } from "../queries";
import { createSaleReturn } from "../actions";

// /sales/returns/create?saleId=… — reached from the Sales list's "Create Sale
// Return". A return always starts from a sale; its lines can only be that
// sale's lines.
export default async function CreateSaleReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ saleId?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SALE_RETURN);
  if (denied) return denied;

  const { saleId } = await searchParams;
  // Re-read the sale server-side; missing or soft-deleted → 404.
  const source = saleId ? await getSaleForReturn(saleId) : null;
  if (!source) {
    notFound();
  }

  if (source.lines.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>
            Create Sale Return
          </h1>
          <GhostButton href="/sales" paddingX={18}>
            <ArrowLeft size={14} strokeWidth={1.7} />
            Back
          </GhostButton>
        </div>
        <div
          style={{
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            boxShadow: "0 1px 2px rgba(23,27,28,.06)",
            padding: "44px 22px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: COLORS.bgApp,
              color: COLORS.slateLight,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PackageCheck size={19} strokeWidth={1.6} />
          </span>
          <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>
            Nothing left to return on{" "}
            <span style={{ fontFamily: FONTS.mono, color: COLORS.text }}>{source.sale.reference}</span> — every item
            has already been returned.
          </span>
        </div>
      </div>
    );
  }

  return (
    <PurchaseForm
      noun="Sale Return"
      listHref="/sales/returns"
      // A return brings stock back in. With fromDocument the quantity cap is
      // each line's returnable amount, not stock.
      stockDirection="in"
      warehouses={[]}
      parties={[]}
      partyLabel="Customer"
      partyField="customerId"
      priceField="price"
      unitLabel="Sale unit"
      statusOptions={SALE_RETURN_STATUS_OPTIONS}
      fromDocument={{
        id: source.sale.id,
        referenceLabel: "Sale reference",
        reference: source.sale.reference,
        partyName: source.sale.customerName,
        warehouseName: source.sale.warehouseName,
      }}
      initial={{
        date: "",
        warehouseId: source.sale.warehouseId,
        partyId: source.sale.customerId,
        status: "PENDING",
        orderTax: "",
        discount: "",
        shipping: "",
        notes: "",
        lines: source.lines,
      }}
      saveAction={createSaleReturn}
    />
  );
}
