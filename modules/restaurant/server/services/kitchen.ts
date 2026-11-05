import "server-only";
import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ActionResult } from "../../lib/actionResult";
import { nextStep, previousStep, timesEntering, timesSteppingBackTo, type KitchenStep } from "../../lib/kds";
import { syncKotBump } from "./kots";

// The kitchen display's line and ticket changes — without the permission
// check and input parsing (../actions/kitchen.ts does those). Every status
// change is an updateMany that only matches while the line is still in the
// step the screen showed, so when two screens tap the same line one wins and
// the other is told. No order version bump: the kitchen's taps don't make a
// waiter's open order screen out of date. No stock moves, no prices change.
//
// LOCK ORDER. Like every waiter change (Send, Mark served, Cancel line),
// these lock the line's order row first, then lines, then tickets — so the
// kitchen and the floor queue up instead of deadlocking. Should MariaDB
// still pick one as a deadlock victim, it's reported as "Updated on another
// screen", which is what happened.

export const UPDATED_ELSEWHERE = "Updated on another screen — refreshed.";
const TICKET_GONE = "That ticket is no longer on the board — refreshed.";

const KITCHEN_ORDER_STATUSES: OrderStatus[] = ["OPEN", "SENT", "SERVED"];

// A line the kitchen can still work on: not cancelled or removed, on a live order.
const workable = {
  deletedAt: null,
  cancelledAt: null,
  order: { deletedAt: null, status: { in: KITCHEN_ORDER_STATUSES } },
} satisfies Prisma.OrderItemWhereInput;

export type KitchenResult = ActionResult & { stale?: true };
const stale = { ok: false, error: UPDATED_ELSEWHERE, stale: true } as const;

// READ COMMITTED: these look up which orders to lock before they wait for
// the locks, and under MariaDB's default (REPEATABLE READ) everything after
// the wait would still be read from that earlier snapshot — a second bump
// wouldn't see the first. Each read here sees what's committed by then.
async function kitchenTransaction(body: (tx: Prisma.TransactionClient) => Promise<KitchenResult>): Promise<KitchenResult> {
  try {
    return await prisma.$transaction(body, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    // P2034: a write conflict or deadlock — another screen got there first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return stale;
    throw error;
  }
}

// Locks the orders these lines are on (id order), before touching the lines.
async function lockOrdersOf(tx: Prisma.TransactionClient, itemIds: readonly string[]): Promise<void> {
  const owners = await tx.orderItem.findMany({ where: { id: { in: [...itemIds] } }, select: { orderId: true } });
  const ids = [...new Set(owners.map((o) => o.orderId))].sort();
  if (ids.length > 0) await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

// Tap a line: one step forward (Sent → Preparing → Ready).
export async function advanceLine(itemId: string, from: KitchenStep): Promise<KitchenResult> {
  const to = nextStep(from);
  if (!to) return { ok: false, error: "Ready lines are served from the order screen." };
  return kitchenTransaction(async (tx): Promise<KitchenResult> => {
    await lockOrdersOf(tx, [itemId]);
    const now = new Date();
    const moved = await tx.orderItem.updateMany({
      where: { id: itemId, kitchenStatus: from, ...workable },
      data: { kitchenStatus: to, ...timesEntering(to, now, now) },
    });
    if (moved.count === 0) return stale;
    // Straight past Preparing (a line sent before startedAt existed): it
    // starts when it's ready.
    if (to === "READY") await tx.orderItem.updateMany({ where: { id: itemId, startedAt: null }, data: { startedAt: now } });
    await syncKotBump(tx, [itemId]);
    return { ok: true };
  });
}

// Tap its pill: one step back (Ready → Preparing → Sent), clearing the
// times of the step it leaves.
export async function recallLine(itemId: string, from: KitchenStep): Promise<KitchenResult> {
  const to = previousStep(from);
  if (!to) return { ok: false, error: "That line is already waiting at the start." };
  return kitchenTransaction(async (tx): Promise<KitchenResult> => {
    await lockOrdersOf(tx, [itemId]);
    const moved = await tx.orderItem.updateMany({
      where: { id: itemId, kitchenStatus: from, ...workable },
      data: { kitchenStatus: to, ...timesSteppingBackTo(to) },
    });
    if (moved.count === 0) return stale;
    await syncKotBump(tx, [itemId]);
    return { ok: true };
  });
}

// Locks the ticket's orders, then the ticket itself (so two screens bumping
// or recalling it queue up), and returns it with its line ids — or null if
// it's gone.
async function lockTicket(tx: Prisma.TransactionClient, kotId: string) {
  const lines = await tx.kotLine.findMany({ where: { kotId }, select: { orderItemId: true } });
  await lockOrdersOf(tx, lines.map((line) => line.orderItemId));
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Kot\` WHERE id = ${kotId} AND type = 'NEW' FOR UPDATE`;
  if (!row) return null;
  return tx.kot.findUniqueOrThrow({ where: { id: kotId }, select: { bumpedAt: true, lines: { select: { orderItemId: true } } } });
}

// All ready: every Sent or Preparing line on the ticket becomes Ready, and
// the ticket is bumped.
export async function bumpTicket(kotId: string): Promise<KitchenResult> {
  return kitchenTransaction(async (tx): Promise<KitchenResult> => {
    const kot = await lockTicket(tx, kotId);
    if (!kot) return { ok: false, error: TICKET_GONE, stale: true };
    if (kot.bumpedAt) return stale;
    const ids = kot.lines.map((line) => line.orderItemId);
    const now = new Date();
    const moved = await tx.orderItem.updateMany({
      where: { id: { in: ids }, kitchenStatus: { in: ["PENDING", "PREPARING"] }, ...workable },
      data: { kitchenStatus: "READY", readyAt: now },
    });
    if (moved.count > 0) {
      // Those that went straight from Sent start when they're ready.
      await tx.orderItem.updateMany({ where: { id: { in: ids }, kitchenStatus: "READY", readyAt: now, startedAt: null }, data: { startedAt: now } });
    }
    await syncKotBump(tx, ids);
    return { ok: true };
  });
}

// Recall (Recently done): the ticket's Ready lines go back to Preparing and
// it's back on the board. Lines already served stay served.
export async function recallTicket(kotId: string): Promise<KitchenResult> {
  return kitchenTransaction(async (tx): Promise<KitchenResult> => {
    const kot = await lockTicket(tx, kotId);
    if (!kot) return { ok: false, error: TICKET_GONE, stale: true };
    if (!kot.bumpedAt) return stale;
    const ids = kot.lines.map((line) => line.orderItemId);
    const moved = await tx.orderItem.updateMany({
      where: { id: { in: ids }, kitchenStatus: "READY", ...workable },
      data: { kitchenStatus: "PREPARING", ...timesSteppingBackTo("PREPARING") },
    });
    if (moved.count === 0) return { ok: false, error: "Nothing to recall — its lines have all been served.", stale: true };
    await syncKotBump(tx, ids);
    return { ok: true };
  });
}
