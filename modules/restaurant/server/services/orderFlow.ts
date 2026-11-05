import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cancelReasonText } from "../../lib/cancelReasons";
import { cancelOrderBlocker } from "../../lib/orderLines";
import type { CancelLineInput, CancelOrderInput } from "../../schemas/orderFlow";
import { createVoidKot, sendNewLines, syncKotBump, type SentToStation } from "./kots";
import { clearSplit, lockOrderAt, markBillChanged, type OrderChangeResult, type OrderFailure } from "./orders";

// Send to kitchen, Mark served and the cancellations — without the
// permission check and input parsing (the server actions in
// ../actions/orders.ts do those). Each locks the order, checks the screen's
// version and bumps it, like every other order change. No stock moves here:
// an order isn't a sale until it's billed.

// `sent`: how many lines went to each station, in station order.
export type SendResult = { ok: true; version: number; sent: SentToStation[] } | OrderFailure;

const LINE_GONE = "That line is no longer on the order — refreshed.";

// Lines that count (not cancelled, not removed).
const counted = { deletedAt: null, cancelledAt: null } satisfies Prisma.OrderItemWhereInput;

const bump = (tx: Prisma.TransactionClient, orderId: string, data: Prisma.OrderUpdateInput = {}) =>
  tx.order.update({ where: { id: orderId }, data: { ...data, version: { increment: 1 } }, select: { version: true } });

// Every counted line served (and there is one) → the order is Served.
async function servedIfDone(tx: Prisma.TransactionClient, orderId: string): Promise<Prisma.OrderUpdateInput> {
  const [lines, unserved] = await Promise.all([
    tx.orderItem.count({ where: { orderId, ...counted } }),
    tx.orderItem.count({ where: { orderId, ...counted, kitchenStatus: { not: "SERVED" } } }),
  ]);
  return lines > 0 && unserved === 0 ? { status: "SERVED" } : {};
}

// Send to kitchen: every line that is still New becomes Sent (PENDING) with
// its station and sent time, and each station gets one KOT for its lines
// (services/kots.ts: a dish with no active station goes to the first
// active one). Only New lines are touched and the order's version is
// checked, so a second click or another device can't send a line twice.
// An Open order becomes Sent — and so does a Served one that has new lines.
export async function sendToKitchen(orderId: string, version: number, userId: string): Promise<SendResult> {
  return prisma.$transaction(async (tx): Promise<SendResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;

    const result = await sendNewLines(tx, orderId, userId);
    if (!result.ok) return result;
    if (result.sent.length === 0) return { ok: true, version, sent: [] };

    const status = locked.order.status === "OPEN" || locked.order.status === "SERVED" ? { status: "SENT" as const } : {};
    await markBillChanged(tx, orderId);
    await clearSplit(tx, orderId);
    const { version: next } = await bump(tx, orderId, status);
    return { ok: true, version: next, sent: result.sent };
  });
}

// Mark served: a Ready line has reached the table. When every counted line
// is served, the order is Served.
export async function markLineServed(orderId: string, version: number, lineId: string): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version, { whilePartPaid: true });
    if (!locked.ok) return locked;
    const line = await tx.orderItem.findFirst({ where: { id: lineId, orderId, ...counted }, select: { kitchenStatus: true } });
    if (!line) return { ok: false, error: LINE_GONE, stale: true };
    if (line.kitchenStatus !== "READY") return { ok: false, error: "Only lines the kitchen has marked Ready can be served — refreshed.", stale: true };

    await tx.orderItem.update({ where: { id: lineId }, data: { kitchenStatus: "SERVED", servedAt: new Date() } });
    await syncKotBump(tx, [lineId]);
    return { ok: true, version: (await bump(tx, orderId, await servedIfDone(tx, orderId))).version };
  });
}

// Mark served from the Ready bar: every line it showed goes to the table at
// once. The lines are locked so the kitchen can't step one back half way
// through: all are still Ready and get served, or nothing changes.
export async function markLinesServed(orderId: string, version: number, lineIds: readonly string[]): Promise<OrderChangeResult> {
  const ids = [...new Set(lineIds)];
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version, { whilePartPaid: true });
    if (!locked.ok) return locked;
    const rows = await tx.$queryRaw<{ id: string; kitchenStatus: string; cancelledAt: Date | null; deletedAt: Date | null }[]>`
      SELECT id, kitchenStatus, cancelledAt, deletedAt FROM \`OrderItem\`
      WHERE orderId = ${orderId} AND id IN (${Prisma.join(ids)}) FOR UPDATE`;
    const ready = rows.filter((row) => row.kitchenStatus === "READY" && !row.cancelledAt && !row.deletedAt);
    if (ready.length !== ids.length) return { ok: false, error: "Some of those lines changed in the kitchen — refreshed.", stale: true };

    await tx.orderItem.updateMany({ where: { id: { in: ids } }, data: { kitchenStatus: "SERVED", servedAt: new Date() } });
    await syncKotBump(tx, ids);
    return { ok: true, version: (await bump(tx, orderId, await servedIfDone(tx, orderId))).version };
  });
}

// Cancel a line that has been sent (New lines are simply removed with the
// stepper). It stays on the ticket, struck through, out of the totals, with
// who cancelled it, when and why — and its station gets a VOID KOT.
export async function cancelLine(input: CancelLineInput, cancelledById: string): Promise<OrderChangeResult> {
  const { orderId, version, lineId, reason, details } = input;
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const line = await tx.orderItem.findFirst({ where: { id: lineId, orderId, ...counted }, select: { kitchenStatus: true } });
    if (!line) return { ok: false, error: LINE_GONE, stale: true };
    if (line.kitchenStatus === "NEW") return { ok: false, error: "That line hasn't been sent — remove it with the − button instead." };

    const why = cancelReasonText(reason, details);
    await tx.orderItem.update({ where: { id: lineId }, data: { cancelledAt: new Date(), cancelReason: why, cancelledById } });
    await createVoidKot(tx, lineId, cancelledById, why);
    await syncKotBump(tx, [lineId]);
    await markBillChanged(tx, orderId);
    await clearSplit(tx, orderId);
    return { ok: true, version: (await bump(tx, orderId, await servedIfDone(tx, orderId))).version };
  });
}

// Cancel the order: it closes with its reason, and its table is free at once
// (an order that's Cancelled no longer holds it — Order.activeTableId).
export async function cancelOrder(input: CancelOrderInput): Promise<OrderChangeResult> {
  const { orderId, version, reason, details } = input;
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const blocker = cancelOrderBlocker(await tx.orderItem.count({ where: { orderId, ...counted, kitchenStatus: { not: "NEW" } } }));
    if (blocker) return { ok: false, error: blocker };

    const { version: next } = await bump(tx, orderId, {
      status: "CANCELLED",
      cancelReason: cancelReasonText(reason, details),
      closedAt: new Date(),
    });
    return { ok: true, version: next };
  });
}
