"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { mergeOrdersSchema, moveOrderSchema } from "../../schemas/orderFlow";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { createTakeawayOrder, markTableCleaned, openTableOrder, TABLE_GONE, type OpenOrderResult } from "../services/floor";
import type { OrderChangeResult } from "../services/orders";
import { mergeOrders, moveOrder, type MergeResult } from "../services/tableMoves";

const requireManageOrders = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
const refresh = () => revalidatePath("/restaurant", "layout");

// Open table: a new Open, Dine-in order on the table, the current user as
// waiter (rules: services/floor.ts). A busy table returns its order's id.
export async function openTable(rawTableId: unknown): Promise<OpenOrderResult> {
  return safely("open table", async (): Promise<OpenOrderResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawTableId);
    if (!parsedId.success) return { ok: false, error: TABLE_GONE };

    const result = await openTableOrder(parsedId.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// New takeaway: an Open order with no table, stocked from the warehouse of
// the area the floor plan is showing.
export async function newTakeaway(rawAreaId: unknown): Promise<OpenOrderResult> {
  return safely("new takeaway", async (): Promise<OpenOrderResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawAreaId);
    if (!parsedId.success) return { ok: false, error: "Add a dining area first." };

    const result = await createTakeawayOrder(parsedId.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// Mark clean: a Cleaning table becomes free again.
export async function markTableClean(rawTableId: unknown): Promise<ActionResult> {
  return safely("mark table clean", async (): Promise<ActionResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsedId = idSchema.safeParse(rawTableId);
    if (!parsedId.success) return { ok: false, error: TABLE_GONE };

    const result = await markTableCleaned(parsedId.data);
    if (result.ok) refresh();
    return result;
  });
}

// Move table: the order to a free table in the same warehouse.
export async function moveOrderToTable(input: unknown): Promise<OrderChangeResult> {
  return safely("move order", async (): Promise<OrderChangeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = moveOrderSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Pick a table to move to." };

    const result = await moveOrder(parsed.data.orderId, parsed.data.version, parsed.data.tableId);
    if (result.ok) refresh();
    return result;
  });
}

// Merge: this order into another occupied table's order.
export async function mergeOrderInto(input: unknown): Promise<MergeResult> {
  return safely("merge orders", async (): Promise<MergeResult> => {
    const authCheck = await requireManageOrders();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = mergeOrdersSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Pick a table to merge into." };

    const result = await mergeOrders(parsed.data.orderId, parsed.data.version, parsed.data.targetOrderId);
    if (result.ok) refresh();
    return result;
  });
}
