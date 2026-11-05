"use server";

import { revalidatePath } from "next/cache";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { orderDetailsSchema } from "../../schemas/order";
import { addLineSchema, editLineSchema, lineQuantitySchema } from "../../schemas/orderLine";
import { cancelLineSchema, cancelOrderSchema, lineActionSchema, sendToKitchenSchema, serveLinesSchema } from "../../schemas/orderFlow";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { cancelLine, cancelOrder, markLineServed, markLinesServed, sendToKitchen, type SendResult } from "../services/orderFlow";
import { addLine, editLine, setLineQuantity } from "../services/orderLines";
import { changeOrderDetails, type OrderChangeResult } from "../services/orders";

// Thin wrappers for the order screen: permission, input parsing and refresh
// here; the rules (locking, the version check) are in services/orders.ts.

const requireManageOrders = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
const refresh = () => revalidatePath("/restaurant", "layout");

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

    const result = await sendToKitchen(parsed.data.orderId, parsed.data.version, authCheck.userId);
    if (result.ok) refresh();
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
// recorded.
export async function cancelOrderLine(input: unknown): Promise<OrderChangeResult> {
  return safely("cancel order line", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = cancelLineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a reason." };

    const result = await cancelLine(parsed.data, authCheck.userId);
    if (result.ok) refresh();
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
