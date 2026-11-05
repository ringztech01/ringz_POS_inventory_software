import { notFound } from "next/navigation";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PREBILL, RECEIPT } from "@/lib/hardware/assignments";
import { currentDeviceId } from "@/lib/hardware/device";
import { printerFor } from "@/lib/hardware/printQueue";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getDiscountApprovers, getWasteApprovers } from "../server/queries/approvers";
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
  const canWaste = current.permissions.has(RESTAURANT_PERMISSIONS.LOG_WASTE);
  const wasteApprovers = canWaste ? await getWasteApprovers() : [];
  const refundView = data.order.status === "BILLED" ? await getRefundView(id) : null;
  // Where this device's pre-bill and receipt print (null: the browser page).
  const deviceId = await currentDeviceId();
  const [prebillPrinter, receiptPrinter] = await Promise.all([printerFor(PREBILL, deviceId), printerFor(RECEIPT, deviceId)]);

  const floorHref = data.order.areaId ? `/restaurant/floor?area=${data.order.areaId}` : "/restaurant/floor";
  return (
    // Flush under the restaurant header and to the edges, filling the
    // window (cancels the dashboard <main>'s padding and gap).
    <div style={{ margin: "-24px -32px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", height: "calc(100vh - 120px)" }}>
      <OrderScreen
        data={data}
        bill={bill}
        approvers={approvers}
        waste={canWaste ? { approvers: wasteApprovers } : null}
        printers={{ prebill: prebillPrinter, receipt: receiptPrinter }}
        canSettle={current.permissions.has(RESTAURANT_PERMISSIONS.SETTLE_BILL)}
        refundView={refundView}
        floorHref={floorHref}
      />
    </div>
  );
}
