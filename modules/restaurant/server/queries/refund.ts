import "server-only";
import { prisma } from "@/lib/db";
import type { RefundSale, RefundSaleLine } from "../../lib/refund";
import { refundableSale } from "../services/refund";

// The Refund pop-up for a settled bill: its sale's lines with what's left to
// refund, the figures the preview shares the discount and service charge
// by, and the refunds made so far. Null unless the order is settled.
export type RefundView = {
  saleId: string;
  saleReference: string;
  sale: RefundSale;
  lines: RefundSaleLine[];
  refunds: { reference: string; amount: string; date: string; returnedToStock: boolean; notes: string | null }[];
};

export async function getRefundView(orderId: string): Promise<RefundView | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null, status: "BILLED", saleId: { not: null } },
    select: {
      saleId: true,
      sale: { select: { reference: true } },
      refunds: {
        where: { deletedAt: null, saleReturn: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: { returnedToStock: true, saleReturn: { select: { reference: true, grandTotal: true, date: true, notes: true } } },
      },
    },
  });
  if (!order?.saleId || !order.sale) return null;
  const { sale, lines } = await refundableSale(prisma, order.saleId);
  return {
    saleId: order.saleId,
    saleReference: order.sale.reference,
    sale,
    lines,
    refunds: order.refunds.map((r) => ({
      reference: r.saleReturn.reference,
      amount: r.saleReturn.grandTotal.toFixed(2),
      date: r.saleReturn.date.toISOString().slice(0, 10),
      returnedToStock: r.returnedToStock,
      notes: r.saleReturn.notes,
    })),
  };
}
