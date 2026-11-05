import "server-only";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ActionFailure, ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS, type RestaurantPermission } from "../../manifest";
import { hasPermissionWhere } from "./orders";

// Approval PINs (ApprovalPin): someone with Approve Discount or Approve Waste
// sets their own on "My approval PIN"; a discount (or waste) above its limit
// names them and carries their PIN, checked against the permission it needs.
// Stored as a bcrypt hash only. Five wrong PINs in a row lock it for five
// minutes, so a 4-digit PIN can't be guessed at the table.

export const PIN_TRIES = 5;
export const PIN_LOCK_MINUTES = 5;
export const WRONG_PIN = "That PIN isn't right.";

const APPROVES = { [RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT]: "discounts", [RESTAURANT_PERMISSIONS.APPROVE_WASTE]: "waste" } as const;
export type ApprovalPermission = keyof typeof APPROVES;

// Sets (or replaces) the user's PIN, and clears any lock.
export async function setApprovalPin(userId: string, pin: string): Promise<ActionResult> {
  const pinHash = await bcrypt.hash(pin, 10);
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const approves = { OR: (Object.keys(APPROVES) as RestaurantPermission[]).map((permission) => hasPermissionWhere(permission)) };
    if ((await tx.user.count({ where: { id: userId, ...approves } })) === 0) {
      return { ok: false, error: "Only someone who can approve discounts or waste sets an approval PIN." };
    }
    await tx.approvalPin.upsert({
      where: { userId },
      create: { userId, pinHash },
      update: { pinHash, failedAttempts: 0, lockedUntil: null },
    });
    return { ok: true };
  });
}

// Inside the change's transaction: the approver has the permission it needs
// (Approve Discount by default), has a PIN, isn't locked out, and the PIN
// matches. A wrong PIN is counted, and the count is kept — the caller returns
// the failure rather than throwing, so the transaction still commits it.
export async function checkApproverPin(
  tx: Prisma.TransactionClient,
  approverId: string,
  pin: string,
  permission: ApprovalPermission = RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT,
): Promise<{ ok: true } | ActionFailure> {
  const approver = await tx.user.findFirst({ where: { id: approverId, ...hasPermissionWhere(permission) }, select: { firstName: true } });
  if (!approver) return { ok: false, error: `That person can't approve ${APPROVES[permission]}. Pick someone else.` };

  const rows = await tx.$queryRaw<{ pinHash: string; failedAttempts: number; lockedUntil: Date | null }[]>`
    SELECT pinHash, failedAttempts, lockedUntil FROM \`ApprovalPin\` WHERE userId = ${approverId} FOR UPDATE`;
  const saved = rows[0];
  if (!saved) return { ok: false, error: `${approver.firstName} hasn't set an approval PIN yet.` };

  const now = new Date();
  if (saved.lockedUntil && saved.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((saved.lockedUntil.getTime() - now.getTime()) / 60_000));
    return { ok: false, error: `Too many wrong PINs. ${approver.firstName}'s PIN is locked for ${minutes} more ${minutes === 1 ? "minute" : "minutes"}.` };
  }

  if (await bcrypt.compare(pin, saved.pinHash)) {
    if (saved.failedAttempts > 0 || saved.lockedUntil) {
      await tx.approvalPin.update({ where: { userId: approverId }, data: { failedAttempts: 0, lockedUntil: null } });
    }
    return { ok: true };
  }

  // A lock that has run out starts the count again.
  const failed = (saved.lockedUntil ? 0 : saved.failedAttempts) + 1;
  const lock = failed >= PIN_TRIES;
  await tx.approvalPin.update({
    where: { userId: approverId },
    data: lock ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) } : { failedAttempts: failed, lockedUntil: null },
  });
  return { ok: false, error: lock ? `${WRONG_PIN} Too many tries — ${approver.firstName}'s PIN is locked for ${PIN_LOCK_MINUTES} minutes.` : WRONG_PIN };
}
