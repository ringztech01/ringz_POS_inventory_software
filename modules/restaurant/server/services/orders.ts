import "server-only";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ActionFailure } from "../../lib/actionResult";
import { EDITABLE_ORDER_STATUSES } from "../../lib/orderLines";
import { RESTAURANT_PERMISSIONS, type RestaurantPermission } from "../../manifest";
import type { OrderDetailsChange } from "../../schemas/order";

// The order screen's rules, without the permission check and input parsing
// (the server actions in ../actions/orders.ts do those). Kept apart so the
// tests can run them against a database.

export const STALE = "This order was changed by someone else — refreshed.";
export const ORDER_CLOSED = "This order is closed, so it can't be changed — refreshed.";
export const ORDER_GONE = "Order not found. It may have been deleted.";
export const PART_PAID = "Part of this bill has been paid, so the order can't change now.";

// `stale`: the screen is out of date and should reload.
export type OrderFailure = ActionFailure & { stale?: true };
export type OrderChangeResult = { ok: true; version: number } | OrderFailure;

type LockedOrder = { status: OrderStatus; tableId: string | null; version: number };

// Locks the order row for the rest of the transaction and checks a change
// may go ahead: the order exists, is still Open, Sent or Served, and is at
// the version the screen showed. Every order-screen write starts here.
// Once a part of a split bill is paid the bill is fixed: changes are
// refused, except those that leave the money alone (`whilePartPaid`: the
// ticket header, moving table, Mark served).
export async function lockOrderAt(
  tx: Prisma.TransactionClient,
  orderId: string,
  version: number,
  { whilePartPaid = false }: { whilePartPaid?: boolean } = {},
): Promise<{ ok: true; order: LockedOrder } | OrderFailure> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT status, tableId, version FROM \`Order\` WHERE id = ${orderId} AND deletedAt IS NULL FOR UPDATE`;
  const order = rows[0];
  if (!order) return { ok: false, error: ORDER_GONE, stale: true };
  if (!EDITABLE_ORDER_STATUSES.includes(order.status)) return { ok: false, error: ORDER_CLOSED, stale: true };
  if (order.version !== version) return { ok: false, error: STALE, stale: true };
  if (!whilePartPaid && (await hasPaidPart(tx, orderId))) return { ok: false, error: PART_PAID };
  return { ok: true, order };
}

export async function hasPaidPart(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  return (await tx.orderBillPart.count({ where: { orderId, deletedAt: null, status: "PAID" } })) > 0;
}

// The bill's money changed (lines sent or cancelled, the discount, the
// service charge, a merge): a split of the old total no longer adds up, so
// its parts go and the waiter splits again. Only unpaid parts can be here —
// lockOrderAt refuses those changes once one is paid.
export async function clearSplit(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.orderBillPart.updateMany({ where: { orderId, deletedAt: null, status: "OPEN" }, data: { deletedAt: new Date() } });
}

// A change to the order after its pre-bill was printed: the print no longer
// matches, so billPrintedAt is cleared and billChangedAt says so ("Bill
// changed since print"). Called inside the change's transaction, after
// lockOrderAt — by every waiter edit; not by kitchen progress or Served.
export async function markBillChanged(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.order.updateMany({ where: { id: orderId, billPrintedAt: { not: null } }, data: { billPrintedAt: null, billChangedAt: new Date() } });
}

// Live users with a permission: the admin role, or a role that has it.
export function hasPermissionWhere(permission: RestaurantPermission): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    userRole: {
      deletedAt: null,
      OR: [{ isSystem: true }, { permissions: { some: { permission } } }],
    },
  };
}

// Users who can take orders: the admin role, or a role with Manage Orders.
export function canTakeOrdersWhere(): Prisma.UserWhereInput {
  return hasPermissionWhere(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
}

// Type, waiter or guests, from the ticket header. Dine-in needs a table;
// the waiter must be someone who can take orders.
export async function changeOrderDetails(orderId: string, version: number, change: OrderDetailsChange): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version, { whilePartPaid: true });
    if (!locked.ok) return locked;

    if (change.field === "type" && change.value === "DINE_IN" && !locked.order.tableId) {
      return { ok: false, error: "Dine-in orders need a table. Open one from the floor plan." };
    }
    if (change.field === "waiterId" && (await tx.user.count({ where: { id: change.value, ...canTakeOrdersWhere() } })) === 0) {
      return { ok: false, error: "Choose a waiter who can take orders." };
    }

    const data =
      change.field === "type" ? { type: change.value }
      : change.field === "guests" ? { guests: change.value }
      : { waiterId: change.value };
    await markBillChanged(tx, orderId);
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { ...data, version: { increment: 1 } },
      select: { version: true },
    });
    return { ok: true, version: updated.version };
  });
}
