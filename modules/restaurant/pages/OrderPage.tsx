import { notFound } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getDiscountApprovers } from "../server/queries/approvers";
import { getBill } from "../server/queries/bill";
import { getRefundView } from "../server/queries/refund";
import { getOrderScreen } from "../server/queries/orderScreen";
import OrderScreen from "../components/order/OrderScreen";

// /restaurant/orders/[id] — the order screen (RingzPOS Table Order design).
// Everything shown is worked out on the server (getOrderScreen). A missing
// or deleted order gets the friendly not-found screen; a Billed or Cancelled
// one opens read-only. Needs Manage Orders.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
  if (denied) return denied;

  const { id } = await params;
  const [data, bill, approvers, current] = await Promise.all([getOrderScreen(id), getBill(id), getDiscountApprovers(), getCurrentUserPermissions()]);
  if (!data || !bill) notFound();
  const refundView = data.order.status === "BILLED" ? await getRefundView(id) : null;

  const floorHref = data.order.areaId ? `/restaurant/floor?area=${data.order.areaId}` : "/restaurant/floor";
  return (
    // Flush under the restaurant header and to the edges, filling the
    // window (cancels the dashboard <main>'s padding and gap).
    <div style={{ margin: "-24px -32px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", height: "calc(100vh - 120px)" }}>
      <OrderScreen
        data={data}
        bill={bill}
        approvers={approvers}
        canSettle={current.permissions.has(RESTAURANT_PERMISSIONS.SETTLE_BILL)}
        refundView={refundView}
        floorHref={floorHref}
      />
    </div>
  );
}
