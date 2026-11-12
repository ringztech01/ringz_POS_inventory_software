"use server";

import { revalidatePath } from "next/cache";
import { currentDeviceId } from "@/lib/hardware/device";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { orderDetailsSchema } from "../../schemas/order";
import { addLineSchema, editLineSchema, holdLinesSchema, lineQuantitySchema, placeLinesSchema } from "../../schemas/orderLine";
import { cancelLineSchema, cancelOrderSchema, lineActionSchema, sendToKitchenSchema, serveLinesSchema } from "../../schemas/orderFlow";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { cancelLine, cancelOrder, markLineServed, markLinesServed, sendToKitchen, type CancelLineResult, type SendResult } from "../services/orderFlow";
import { addLine, editLine, holdLines, placeLines, setLineQuantity } from "../services/orderLines";
import { changeOrderDetails, type OrderChangeResult } from "../services/orders";
import { printNewKots } from "../services/printing";

// Thin wrappers for the order screen: permission, input parsing and refresh
// here; the rules (locking, the version check) are in services/orders.ts.

const requireManageOrders = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
// The restaurant pages and the touch POS (/pos in Restaurant mode).
const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos");
};

// A ticket header select: order type, waiter or guests.
export async function updateOrderDetails(input: unknown): Promise<OrderChangeResult> {
  return safely("update order details", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = orderDetailsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid." };

    const { orderId, version, change } = parsed.data;
    const result = await changeOrderDetails(orderId, version, change);
    if (result.ok) refresh();
    return result;
  });
}

// Tap a dish / Add to order: the dish, option ids and note only — the server
// prices it.
export async function addOrderLine(input: unknown): Promise<OrderChangeResult> {
  return safely("add order line", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = addLineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That dish can't be added." };

    const result = await addLine(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// The pencil: a New line's options and note.
export async function editOrderLine(input: unknown): Promise<OrderChangeResult> {
  return safely("edit order line", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = editLineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That change isn't valid." };

    const result = await editLine(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// The stepper (debounced on the screen): a New line's quantity; 0 removes it.
export async function setOrderLineQuantity(input: unknown): Promise<OrderChangeResult> {
  return safely("set order line quantity", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = lineQuantitySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "A line's quantity is 1 to 99." };

    const result = await setLineQuantity(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// Send to kitchen: every New line, once.
export async function sendOrderToKitchen(input: unknown): Promise<SendResult> {
  return safely("send order to kitchen", async (): Promise<SendResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = sendToKitchenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That order can't be sent." };

    const result = await sendToKitchen(parsed.data.orderId, parsed.data.version, authCheck.userId, parsed.data.lineIds);
    if (result.ok) {
      refresh();
      // Each station's KOT to its printer (Settings › Printers).
      await printNewKots(result.kotIds, { userId: authCheck.userId, deviceId: await currentDeviceId() });
    }
    return result;
  });
}

// Mark served: a Ready line has reached the table.
export async function markOrderLineServed(input: unknown): Promise<OrderChangeResult> {
  return safely("mark order line served", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = lineActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That line can't be marked served." };

    const result = await markLineServed(parsed.data.orderId, parsed.data.version, parsed.data.lineId);
    if (result.ok) refresh();
    return result;
  });
}

// Cancel a sent line, with a reason. Needs Manage Orders; the canceller is
// recorded. Returned by guest with the food wasted also needs Log Waste.
export async function cancelOrderLine(input: unknown): Promise<CancelLineResult> {
  return safely("cancel order line", async (): Promise<CancelLineResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = cancelLineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a reason." };
    if (parsed.data.wasted) {
      const wasteCheck = await requirePermission(RESTAURANT_PERMISSIONS.LOG_WASTE);
      if (wasteCheck.error !== undefined) return { ok: false, error: wasteCheck.error };
    }

    const mayVoid = (await getCurrentUserPermissions()).permissions.has(RESTAURANT_PERMISSIONS.APPROVE_VOID);
    const result = await cancelLine(parsed.data, authCheck.userId, { mayVoid });
    if (result.ok) {
      refresh();
      // The station's VOID ticket.
      if (result.voidKotId) await printNewKots([result.voidKotId], { userId: authCheck.userId, deviceId: await currentDeviceId() });
    }
    return result;
  });
}

// Cancel the whole order (nothing live in the kitchen); frees its table.
export async function cancelRestaurantOrder(input: unknown): Promise<OrderChangeResult> {
  return safely("cancel order", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = cancelOrderSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a reason." };

    const result = await cancelOrder(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// Mark served (the Ready bar): every Ready line it showed, at once.
export async function markOrderLinesServed(input: unknown): Promise<OrderChangeResult> {
  return safely("mark order lines served", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = serveLinesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Nothing to serve." };

    const result = await markLinesServed(parsed.data.orderId, parsed.data.version, parsed.data.lineIds);
    if (result.ok) refresh();
    return result;
  });
}

// The touch POS's Seat & course: a seat and / or course for lines.
export async function placeOrderLines(input: unknown): Promise<OrderChangeResult> {
  return safely("place order lines", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = placeLinesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That seat or course can't be set." };
    const result = await placeLines(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// The touch POS's Hold: hold (or release) lines not sent yet.
export async function holdOrderLines(input: unknown): Promise<OrderChangeResult> {
  return safely("hold order lines", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = holdLinesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those lines can't be held." };
    const result = await holdLines(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}
