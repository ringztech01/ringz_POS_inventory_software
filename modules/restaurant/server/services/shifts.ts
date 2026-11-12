import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { asksToStart, shiftState, startOfAppDay, type ShiftState } from "../../lib/shifts";
import { orderRef } from "../../lib/format";
import { noTableLabel, withCheck } from "../../lib/orderLines";
import { canTakeOrdersWhere } from "./orders";
import { defaultDisplayName } from "../../lib/staffPins";

// Clock in / out (Part 6f Step 6; switched on in Settings › Staff). A shift
// starts after a PIN sign-in ("Start shift?") and ends at LOCK ("End
// shift?"). Each start and end is logged.

type Db = Prisma.TransactionClient | typeof prisma;

export async function clockInOutOn(db: Db = prisma): Promise<boolean> {
  const row = await db.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantClockInOut: true } });
  return row?.restaurantClockInOut ?? false;
}

const openShiftOf = (db: Db, userId: string) =>
  db.staffShift.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" }, select: { id: true, startedAt: true } });

export type ShiftStatus = { clockOn: boolean; state: ShiftState; askStart: boolean };

export async function shiftStatus(userId: string, now = new Date()): Promise<ShiftStatus> {
  const [clockOn, open] = await Promise.all([clockInOutOn(), openShiftOf(prisma, userId)]);
  const state = shiftState(open, now);
  return { clockOn, state, askStart: asksToStart(clockOn, state) };
}

// "Start shift": a shift left open from an earlier day is closed now
// (AUTO); one already started today is kept (nothing new).
export async function startShift(userId: string, deviceId: string | null, now = new Date()): Promise<{ ok: true; started: boolean } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    if (!(await clockInOutOn(tx))) return { ok: false as const, error: "Clock in / out is turned off (Settings › Staff)." };
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
    const open = await openShiftOf(tx, userId);
    if (shiftState(open, now) === "ON") return { ok: true as const, started: false };
    if (open) {
      await tx.staffShift.update({ where: { id: open.id }, data: { endedAt: now, endReason: "AUTO" } });
      await writeAudit({ userId, action: "shift.end", entityType: "StaffShift", entityId: open.id, meta: { reason: "AUTO" } }, tx);
    }
    const shift = await tx.staffShift.create({ data: { userId, startedAt: now, startDeviceId: deviceId }, select: { id: true } });
    await writeAudit({ userId, action: "shift.start", entityType: "StaffShift", entityId: shift.id, meta: { deviceId } }, tx);
    return { ok: true as const, started: true };
  });
}

// Shift handover (Part 6f Step 7a): their open tables, and who can take them
// (people who take orders; whoever's on shift first).
export type HandoverOrder = { id: string; ref: string; label: string; guests: number; lines: number; openedAt: string };
export type Handover = { orders: HandoverOrder[]; to: { id: string; name: string; onShift: boolean }[] };
export type EndShiftResult = { ok: true; ended: number; transferred: number } | { ok: false; error: string; needsHandover?: Handover };

const OPEN_STATUSES = ["OPEN", "SENT", "SERVED"] as const;

// "End shift" (at LOCK): every shift they have open ends now. Someone with
// open orders hands them to another waiter first (`transferTo`), in the same
// transaction (each order's version moves on, so a screen still showing the
// old waiter refreshes); refused with `needsHandover` until they pick one.
export async function endShift(userId: string, deviceId: string | null, now = new Date(), { transferTo = null }: { transferTo?: string | null } = {}): Promise<EndShiftResult> {
  return prisma.$transaction(async (tx): Promise<EndShiftResult> => {
    await tx.$queryRaw`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`;
    const orders = await tx.order.findMany({
      where: { waiterId: userId, status: { in: [...OPEN_STATUSES] }, deletedAt: null },
      orderBy: [{ openedAt: "asc" }, { number: "asc" }],
      select: { id: true, number: true, type: true, tabName: true, guests: true, openedAt: true, checkNumber: true, checkName: true, table: { select: { name: true } }, _count: { select: { items: { where: { deletedAt: null, cancelledAt: null } } } } },
    });
    let transferred = 0;
    if (orders.length) {
      if (!transferTo) {
        const [people, onShift] = await Promise.all([
          tx.user.findMany({ where: { ...canTakeOrdersWhere(), id: { not: userId } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, displayName: true } }),
          onShiftUserIds(now),
        ]);
        const to = people
          .map((p) => ({ id: p.id, name: p.displayName || defaultDisplayName(p.firstName, p.lastName), onShift: onShift.includes(p.id) }))
          .sort((a, b) => Number(b.onShift) - Number(a.onShift));
        return {
          ok: false,
          error: `You have ${orders.length} open ${orders.length === 1 ? "table" : "tables"}. Hand ${orders.length === 1 ? "it" : "them"} to someone else first.`,
          needsHandover: {
            orders: orders.map((o) => ({
              id: o.id,
              ref: orderRef(o.number),
              label: o.table ? withCheck(o.table.name, o) : noTableLabel(o.type, o.tabName),
              guests: o.guests,
              lines: o._count.items,
              openedAt: o.openedAt.toISOString(),
            })),
            to,
          },
        };
      }
      if (transferTo === userId) return { ok: false, error: "Pick someone else to take your tables." };
      const taker = await tx.user.findFirst({ where: { ...canTakeOrdersWhere(), id: transferTo }, select: { firstName: true, lastName: true } });
      if (!taker) return { ok: false, error: "That person can't take the orders. Pick someone else." };
      await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { waiterId: transferTo, version: { increment: 1 } } });
      transferred = orders.length;
      await writeAudit(
        { userId, action: "shift.handover", entityType: "User", entityId: transferTo, meta: { to: `${taker.firstName} ${taker.lastName}`.trim(), count: orders.length, orders: orders.map((o) => o.id) } },
        tx,
      );
    }
    const open = await tx.staffShift.findMany({ where: { userId, endedAt: null }, select: { id: true } });
    for (const shift of open) {
      await tx.staffShift.update({ where: { id: shift.id }, data: { endedAt: now, endReason: "ENDED", endDeviceId: deviceId } });
      await writeAudit({ userId, action: "shift.end", entityType: "StaffShift", entityId: shift.id, meta: { reason: "ENDED", deviceId } }, tx);
    }
    return { ok: true, ended: open.length, transferred };
  });
}

// The PIN screen's "on shift" list with clock in/out on: who has a shift
// open that started today.
export async function onShiftUserIds(now = new Date()): Promise<string[]> {
  const rows = await prisma.staffShift.findMany({ where: { endedAt: null, startedAt: { gte: startOfAppDay(now) } }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))];
}

export async function setClockInOut(on: boolean, actorId: string): Promise<{ ok: true }> {
  await prisma.$transaction(async (tx) => {
    const before = await clockInOutOn(tx);
    if (before === on) return;
    await tx.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, restaurantClockInOut: on }, update: { restaurantClockInOut: on } });
    await writeAudit({ userId: actorId, action: "staff.settings", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { from: { clockInOut: before }, to: { clockInOut: on } } }, tx);
  });
  return { ok: true };
}
