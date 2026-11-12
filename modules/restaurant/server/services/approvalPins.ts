import "server-only";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { ActionFailure, ActionResult } from "../../lib/actionResult";
import { PERMISSIONS } from "@/lib/permissions";
import { RESTAURANT_PERMISSIONS, type RestaurantPermission } from "../../manifest";
import { hasPermissionWhere } from "./orders";

// PINs (ApprovalPin) — one per person, set on "My PIN": it signs a waiter in
// on the touch POS (Part 6e), and for someone with Approve Discount or
// Approve Waste it approves a discount (or waste) above its limit, checked
// against the permission it needs. Stored as a bcrypt hash only. Five wrong
// PINs in a row lock it for five minutes, so a 4-digit PIN can't be guessed
// at the table.

export const PIN_TRIES = 5;
export const PIN_LOCK_MINUTES = 5;
export const WRONG_PIN = "That PIN isn't right.";

const APPROVES = {
  [RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT]: "discounts",
  [RESTAURANT_PERMISSIONS.APPROVE_WASTE]: "waste",
  [RESTAURANT_PERMISSIONS.APPROVE_VOID]: "voids and refunds",
  [PERMISSIONS.OPEN_DRAWER]: "opening the drawer",
} as const;
export type ApprovalPermission = keyof typeof APPROVES;

// Who has a PIN: anyone who takes orders (signs in on the POS) or approves.
const PIN_PERMISSIONS: readonly RestaurantPermission[] = [
  RESTAURANT_PERMISSIONS.MANAGE_ORDERS,
  RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT,
  RESTAURANT_PERMISSIONS.APPROVE_WASTE,
  RESTAURANT_PERMISSIONS.APPROVE_VOID,
];

// Sets (or replaces) the user's PIN, and clears any lock.
export async function setApprovalPin(userId: string, pin: string): Promise<ActionResult> {
  const pinHash = await bcrypt.hash(pin, 10);
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const allowed = { OR: PIN_PERMISSIONS.map((permission) => hasPermissionWhere(permission)) };
    if ((await tx.user.count({ where: { id: userId, ...allowed } })) === 0) {
      return { ok: false, error: "Only someone who takes orders or approves discounts or waste sets a PIN." };
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
  return checkUserPin(tx, approverId, pin, approver.firstName, "an approval PIN");
}

// The touch POS's manager PIN (Part 6e): a void of a sent line, a refund, a
// drawer opened by hand. Someone who may do it themselves (`may`) just
// does; anyone else needs the PIN of someone who may — refused with
// `needsManager` until it comes, so the screen can ask for it.
export type ManagerFor = "VOID" | "REFUND" | "DRAWER";
export type NeedsManager = ActionFailure & { needsManager: ManagerFor };
export type ManagerApproval = { approverId: string; pin: string };

const MANAGER: Record<ManagerFor, { permission: ApprovalPermission; ask: string }> = {
  VOID: { permission: RESTAURANT_PERMISSIONS.APPROVE_VOID, ask: "Voiding a sent line needs a manager's PIN." },
  REFUND: { permission: RESTAURANT_PERMISSIONS.APPROVE_VOID, ask: "A refund needs a manager's PIN." },
  DRAWER: { permission: PERMISSIONS.OPEN_DRAWER, ask: "Opening the drawer needs a manager's PIN." },
};

export async function requireManager(
  tx: Prisma.TransactionClient,
  input: { for: ManagerFor; may: boolean; approval?: ManagerApproval },
): Promise<{ ok: true; approvedBy: string | null; approverId: string | null } | ActionFailure | NeedsManager> {
  if (input.may) return { ok: true, approvedBy: null, approverId: null };
  const rule = MANAGER[input.for];
  if (!input.approval) return { ok: false, error: rule.ask, needsManager: input.for };
  const checked = await checkApproverPin(tx, input.approval.approverId, input.approval.pin, rule.permission);
  if (!checked.ok) return checked;
  const approver = await tx.user.findUniqueOrThrow({ where: { id: input.approval.approverId }, select: { firstName: true } });
  return { ok: true, approvedBy: approver.firstName, approverId: input.approval.approverId };
}

// A manager's override (Part 6f Step 6): their PIN approved one action for
// someone else, whose session it stays. Logged against both people, in the
// change's own transaction once the change is made: "override.<kind>" for the
// one who asked (approvedById), "override.<kind>.approve" for the approver
// (forUserId). Never the PIN.
export type OverrideKind = "void" | "refund" | "drawer" | "discount" | "waste";

export async function logOverride(
  tx: Prisma.TransactionClient,
  input: { kind: OverrideKind; actorId: string; approverId: string; entityType: string; entityId?: string | null; meta?: Record<string, string | number | boolean | null> },
): Promise<void> {
  const meta = input.meta ?? {};
  await writeAudit({ userId: input.actorId, action: `override.${input.kind}`, entityType: input.entityType, entityId: input.entityId ?? null, meta: { ...meta, approvedById: input.approverId } }, tx);
  await writeAudit({ userId: input.approverId, action: `override.${input.kind}.approve`, entityType: input.entityType, entityId: input.entityId ?? null, meta: { ...meta, forUserId: input.actorId } }, tx);
}

// Any user's PIN, lock-out included (the approvals above, the POS sign-in).
// A wrong PIN is counted and the count kept — the caller returns the
// failure rather than throwing, so the transaction still commits it.
// Whose PIN is it (the PIN Login design: no name needed)? Everyone who
// takes orders and has a PIN that isn't locked is tried; one match is that
// person, none is a wrong PIN, two (a shared PIN) means tap your name first.
// Guessing is held back per till by the caller (switchPosUser).
export async function findByPin(pin: string, where: Prisma.UserWhereInput): Promise<{ kind: "one"; user: { id: string; firstName: string } } | { kind: "none" } | { kind: "shared" }> {
  const now = new Date();
  const people = await prisma.user.findMany({ where: { ...where, approvalPin: { isNot: null } }, select: { id: true, firstName: true, approvalPin: { select: { pinHash: true, lockedUntil: true } } } });
  const matches: { id: string; firstName: string }[] = [];
  for (const person of people) {
    const saved = person.approvalPin;
    if (!saved || (saved.lockedUntil && saved.lockedUntil > now)) continue;
    if (await bcrypt.compare(pin, saved.pinHash)) matches.push({ id: person.id, firstName: person.firstName });
  }
  if (matches.length === 1) return { kind: "one", user: matches[0] };
  return matches.length === 0 ? { kind: "none" } : { kind: "shared" };
}

export async function checkUserPin(tx: Prisma.TransactionClient, userId: string, pin: string, name: string, what = "a PIN"): Promise<{ ok: true } | ActionFailure> {
  const rows = await tx.$queryRaw<{ pinHash: string; failedAttempts: number; lockedUntil: Date | null }[]>`
    SELECT pinHash, failedAttempts, lockedUntil FROM \`ApprovalPin\` WHERE userId = ${userId} FOR UPDATE`;
  const saved = rows[0];
  if (!saved) return { ok: false, error: `${name} hasn't set ${what} yet.` };

  const now = new Date();
  if (saved.lockedUntil && saved.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((saved.lockedUntil.getTime() - now.getTime()) / 60_000));
    return { ok: false, error: `Too many wrong PINs. ${name}'s PIN is locked for ${minutes} more ${minutes === 1 ? "minute" : "minutes"}.` };
  }

  if (await bcrypt.compare(pin, saved.pinHash)) {
    if (saved.failedAttempts > 0 || saved.lockedUntil) {
      await tx.approvalPin.update({ where: { userId: userId }, data: { failedAttempts: 0, lockedUntil: null } });
    }
    return { ok: true };
  }

  // A lock that has run out starts the count again.
  const failed = (saved.lockedUntil ? 0 : saved.failedAttempts) + 1;
  const lock = failed >= PIN_TRIES;
  await tx.approvalPin.update({
    where: { userId: userId },
    data: lock ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) } : { failedAttempts: failed, lockedUntil: null },
  });
  return { ok: false, error: lock ? `${WRONG_PIN} Too many tries — ${name}'s PIN is locked for ${PIN_LOCK_MINUTES} minutes.` : WRONG_PIN };
}
