import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { prisma } from "@/lib/db";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { COLORS } from "@/components/layout/theme";
import { orderRef } from "../../lib/format";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";
import { restaurantModule } from "../../manifest";

// On the retail Sale details page: a sale made by settling a restaurant bill
// links back to its order — where its refunds are made. Nothing for any
// other sale, or while the Restaurant module is off.
export default async function SaleOrderLink({ saleId }: { saleId: string }) {
  if (!(await isModuleEnabled(restaurantModule.id))) return null;
  const order = await prisma.order.findFirst({
    where: { saleId, deletedAt: null },
    select: { id: true, number: true, type: true, table: { select: { name: true } } },
  });
  if (!order) return null;

  return (
    <Link
      href={`/restaurant/orders/${order.id}`}
      data-sale-order
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderRadius: 10,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.tealTint,
        color: COLORS.tealDark,
        fontSize: 13.5,
        textDecoration: "none",
      }}
    >
      <UtensilsCrossed size={16} strokeWidth={1.8} />
      <span>
        <strong>Restaurant order {orderRef(order.number)}</strong> · {order.table ? `Table ${order.table.name}` : ORDER_TYPE_LABEL[order.type]} — its refunds are made from the order.
      </span>
    </Link>
  );
}
