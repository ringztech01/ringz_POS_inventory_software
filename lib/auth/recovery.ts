import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { normaliseRecoveryCode, recoveryCodeFrom } from "./recoveryCode";

// Emergency access (Part 6f Step 4): one recovery code at a time, made by an
// Administrator on Settings › Staff, shown once (to print or save) and kept
// only as a bcrypt hash on BusinessSetting. On the email sign-in page of a
// device that isn't a PIN terminal, an Administrator's email and the code
// sign that Administrator in — once: the code is used up, and a new one has
// to be made. Making a new code replaces the old one.

// Guessing held back, per server process: 5 wrong codes and the recovery
// sign-in waits 15 minutes (a code is ~100 bits, so this is belt and braces).
const TRIES = 5;
const WAIT_MS = 15 * 60_000;
const store = globalThis as typeof globalThis & { __recoveryGuesses?: { fails: number; until: number } };

export async function createRecoveryCode(actorId: string): Promise<string> {
  const code = recoveryCodeFrom(randomBytes(20));
  const hash = await bcrypt.hash(normaliseRecoveryCode(code)!, 10);
  await prisma.$transaction(async (tx) => {
    const before = await tx.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { recoveryCodeHash: true } });
    const at = new Date();
    await tx.businessSetting.upsert({
      where: { id: BUSINESS_SETTINGS_ID },
      create: { id: BUSINESS_SETTINGS_ID, recoveryCodeHash: hash, recoveryCodeAt: at },
      update: { recoveryCodeHash: hash, recoveryCodeAt: at },
    });
    await writeAudit({ userId: actorId, action: "recovery.create", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { replaced: !!before?.recoveryCodeHash } }, tx);
  });
  return code;
}

// When the current code was made (null: there's none, or it was used).
export async function recoveryCodeMadeAt(): Promise<Date | null> {
  const row = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { recoveryCodeHash: true, recoveryCodeAt: true } });
  return row?.recoveryCodeHash ? (row.recoveryCodeAt ?? new Date(0)) : null;
}

export type RecoveredUser = { id: string; email: string; firstName: string; lastName: string; image: string | null; role: UserRole; sessionVersion: number };

// The recovery sign-in: an active Administrator's email and the code. Right,
// the code is used up (in the same transaction, under a lock on the settings
// row, so it can't be used twice) and logged; null otherwise.
export async function redeemRecoveryCode(email: unknown, typed: unknown, now = Date.now()): Promise<RecoveredUser | null> {
  const held = store.__recoveryGuesses;
  if (held && held.until > now) return null;
  const code = normaliseRecoveryCode(typed);
  if (typeof email !== "string" || !email.trim() || !code) return wrong(now);

  const user = await prisma.user.findFirst({
    where: { email: email.trim(), deletedAt: null, disabledAt: null, userRole: { is: { isSystem: true, deletedAt: null } } },
    select: { id: true, email: true, firstName: true, lastName: true, image: true, role: true, sessionVersion: true },
  });
  const used = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ recoveryCodeHash: string | null }[]>`
      SELECT recoveryCodeHash FROM \`BusinessSetting\` WHERE id = ${BUSINESS_SETTINGS_ID} FOR UPDATE`;
    const hash = rows[0]?.recoveryCodeHash;
    if (!hash || !(await bcrypt.compare(code, hash)) || !user) return false;
    await tx.businessSetting.update({ where: { id: BUSINESS_SETTINGS_ID }, data: { recoveryCodeHash: null } });
    await writeAudit({ userId: user.id, action: "recovery.use", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID }, tx);
    return true;
  });
  if (!used || !user) {
    // Logged without the code; the email only as typed.
    await writeAudit({ userId: null, action: "recovery.fail", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { email: email.trim().slice(0, 120) } }).catch(() => undefined);
    return wrong(now);
  }
  store.__recoveryGuesses = undefined;
  return user;
}

function wrong(now: number): null {
  const held = store.__recoveryGuesses;
  const fails = (held && held.until === 0 ? held.fails : 0) + 1;
  store.__recoveryGuesses = fails >= TRIES ? { fails: 0, until: now + WAIT_MS } : { fails, until: 0 };
  return null;
}
