import "server-only";
import { prisma } from "@/lib/db";
import { formatNaira } from "@/lib/format";
import { orderRef } from "../../lib/format";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";

// What the restaurant adds to the retail receipt for a settled bill: the
// order, its table and waiter, and the tips taken with it. Null when the
// sale isn't a restaurant order's.
export async function getReceiptExtras(saleId: string): Promise<{ details: [string, string][]; tips: [string, string][] } | null> {
  const order = await prisma.order.findFirst({
    where: { saleId, deletedAt: null },
    select: {
      number: true,
      type: true,
      table: { select: { name: true } },
      waiter: { select: { firstName: true } },
      tips: { where: { deletedAt: null }, select: { amount: true, waiter: { select: { firstName: true } } } },
    },
  });
  if (!order) return null;
  const tips = new Map<string, number>();
  for (const tip of order.tips) tips.set(tip.waiter.firstName, (tips.get(tip.waiter.firstName) ?? 0) + Math.round(Number(tip.amount) * 100));
  return {
    details: [
      ["Order", orderRef(order.number)],
      order.table ? ["Table", order.table.name] : ["Type", ORDER_TYPE_LABEL[order.type]],
      ["Waiter", order.waiter?.firstName ?? "—"],
    ],
    tips: [...tips].map(([waiter, kobo]) => [`Tip · ${waiter}`, formatNaira((kobo / 100).toFixed(2))]),
  };
}
