import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orderRef } from "../../lib/format";
import { EDITABLE_ORDER_STATUSES } from "../../lib/orderLines";
import { mergedOrderStatus } from "../../lib/tableMoves";
import { tableStatus } from "../../lib/tableStatus";
import { lockTable } from "../locks";
import { isUniqueViolation } from "../prismaErrors";
import { tableStateSelect } from "../queries/tables";
import { getTableStatusRules } from "../rules";
import { clearSplit, hasPaidPart, lockOrderAt, markBillChanged, type OrderChangeResult, type OrderFailure } from "./orders";

// Move table and Merge, from the floor plan's side panel — without the
// permission check and input parsing (../actions/floor.ts does those). Both
// check the moving order's version like every order change, run in one
// transaction, and leave lines and their kitchen states as they are.

export const TAKEN = "That table has just been taken. Pick another one.";
const counted = { deletedAt: null, cancelledAt: null } satisfies Prisma.OrderItemWhereInput;

async function orderWarehouse(tx: Prisma.TransactionClient, orderId: string) {
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { warehouseId: true } });
}

// Move table: the order goes to a free table — Available, or Reserved (the
// screen warns first) — in the same warehouse. The table is locked and
// tableStatus decides it's free; the one-open-order-per-table index catches
// anything that slips past.
export async function moveOrder(orderId: string, version: number, tableId: string): Promise<OrderChangeResult> {
  const rules = await getTableStatusRules();
  try {
    return await prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
      const locked = await lockOrderAt(tx, orderId, version, { whilePartPaid: true });
      if (!locked.ok) return locked;
      if (locked.order.tableId === tableId) return { ok: false, error: "The order is already at that table." };
      const { warehouseId } = await orderWarehouse(tx, orderId);

      if (!(await lockTable(tx, tableId))) return { ok: false, error: "That table is no longer on the floor.", stale: true };
      const now = new Date();
      const table = await tx.table.findUniqueOrThrow({
        where: { id: tableId },
        select: { name: true, area: { select: { warehouseId: true, deletedAt: true } }, ...tableStateSelect(now, rules) },
      });
      if (table.area.deletedAt) return { ok: false, error: "That table is no longer on the floor.", stale: true };
      if (table.area.warehouseId !== warehouseId) return { ok: false, error: `${table.name} is served from another warehouse. Pick a table in this one.` };
      const status = tableStatus(table, rules, now)?.status;
      if (status === "Occupied") return { ok: false, error: TAKEN, stale: true };
      if (status === "Cleaning") return { ok: false, error: `${table.name} still needs cleaning. Mark it clean first.` };

      await markBillChanged(tx, orderId);
      const moved = await tx.order.update({
        where: { id: orderId },
        data: { tableId, version: { increment: 1 } },
        select: { version: true },
      });
      return { ok: true, version: moved.version };
    });
  } catch (error) {
    if (isUniqueViolation(error, "activeTableId")) return { ok: false, error: TAKEN, stale: true };
    throw error;
  }
}

export type MergeResult = { ok: true; version: number; targetOrderId: string; targetRef: string } | OrderFailure;

// Merge: this order's lines (and guests) join the order at another occupied
// table in the same warehouse; this order is cancelled "Merged into
// ORD-xxxx" and its table freed. Blocked if either order is billed.
export async function mergeOrders(orderId: string, version: number, targetOrderId: string): Promise<MergeResult> {
  if (orderId === targetOrderId) return { ok: false, error: "Pick another table's order to merge into." };
  return prisma.$transaction(async (tx): Promise<MergeResult> => {
    // Lock both orders, always in the same (id) order so two merges between
    // the same pair can't deadlock; then check this one's version.
    const [first, second] = [orderId, targetOrderId].sort();
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`;
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;

    const target = await tx.order.findFirst({
      where: { id: targetOrderId, deletedAt: null },
      select: { status: true, number: true, guests: true, warehouseId: true, tableId: true },
    });
    if (!target || !target.tableId) return { ok: false, error: "That table's order is no longer open — refreshed.", stale: true };
    if (!EDITABLE_ORDER_STATUSES.includes(target.status)) {
      return { ok: false, error: `${orderRef(target.number)} is ${target.status === "BILLED" ? "billed" : "closed"} and can't take more lines — refreshed.`, stale: true };
    }
    if (await hasPaidPart(tx, targetOrderId)) return { ok: false, error: `Part of ${orderRef(target.number)}'s bill has been paid, so nothing can join it now.` };
    const source = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { guests: true, warehouseId: true } });
    if (source.warehouseId !== target.warehouseId) return { ok: false, error: "Orders from different warehouses can't be merged." };

    // Every line moves (cancelled and removed ones too, to keep the history).
    await tx.orderItem.updateMany({ where: { orderId }, data: { orderId: targetOrderId } });

    // Then the joined order's status follows its lines.
    const [live, sent, unserved] = await Promise.all([
      tx.orderItem.count({ where: { orderId: targetOrderId, ...counted } }),
      tx.orderItem.count({ where: { orderId: targetOrderId, ...counted, kitchenStatus: { not: "NEW" } } }),
      tx.orderItem.count({ where: { orderId: targetOrderId, ...counted, kitchenStatus: { not: "SERVED" } } }),
    ]);
    const status = mergedOrderStatus({ live, sent, unserved }, target.status);
    const targetRef = orderRef(target.number);
    await markBillChanged(tx, targetOrderId);
    // Neither bill is what it was: any split of either goes.
    await clearSplit(tx, targetOrderId);
    await clearSplit(tx, orderId);
    await tx.order.update({
      where: { id: targetOrderId },
      data: { guests: target.guests + source.guests, status, version: { increment: 1 } },
    });
    const merged = await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelReason: `Merged into ${targetRef}`, closedAt: new Date(), version: { increment: 1 } },
      select: { version: true },
    });
    return { ok: true, version: merged.version, targetOrderId, targetRef };
  });
}
