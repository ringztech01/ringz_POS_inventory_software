import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSaleDocument } from "@/app/(dashboard)/sales/queries";
import PrintOnOpen from "@/components/pos/PrintOnOpen";
import SaleReceipt from "@/components/pos/SaleReceipt";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getReceiptExtras } from "../server/queries/receipt";

export const metadata: Metadata = { title: "Receipt — RingzPOS" };

// /restaurant/receipt/[saleId] — the receipt for a settled bill: the retail
// till receipt (components/pos/SaleReceipt.tsx) for the order's sale, with
// the order, table and waiter, the service charge by its name and the tips.
// Only a restaurant order's sale. Needs Manage Orders.
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
  if (denied) return denied;

  const { id } = await params;
  const [sale, extras] = await Promise.all([getSaleDocument(id), getReceiptExtras(id)]);
  if (!sale || !extras) notFound();

  return (
    <div style={{ padding: "32px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <style>{`@media print { .no-print { display:none !important; } body, body > div { background:#fff !important; min-width:0 !important; } }`}</style>
      <PrintOnOpen />
      <SaleReceipt sale={sale} details={extras.details} shippingLabel="Service charge" afterPayments={extras.tips} />
    </div>
  );
}
