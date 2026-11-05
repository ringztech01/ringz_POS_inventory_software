import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { getSaleDocument } from "@/app/(dashboard)/sales/queries";
import PrintOnOpen from "@/components/pos/PrintOnOpen";
import SaleReceipt from "@/components/pos/SaleReceipt";

export const metadata: Metadata = { title: "Receipt — RingzPOS" };

// /pos/receipt/[id] — the till receipt for a sale (components/pos/
// SaleReceipt.tsx: the same document the Sale Details page and its PDF
// render, laid out for a receipt printer). Manage Pos Screen, so a cashier
// without Manage Sale can print it.
export default async function PosReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_POS_SCREEN);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const { id } = await params;
  const sale = await getSaleDocument(id);
  if (!sale) notFound();

  return (
    <div style={{ padding: "32px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <style>{`@media print { .no-print { display:none !important; } body, body > div { background:#fff !important; min-width:0 !important; } }`}</style>
      <PrintOnOpen />
      <SaleReceipt sale={sale} />
    </div>
  );
}
