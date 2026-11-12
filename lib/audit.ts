import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

// The audit log (AuditLog): who did what, to what, when. Generic — any part
// of the app can write to it. Pass the transaction when the change it
// records is made in one, so the entry and the change stand or fall together.
//   action: "<area>.<thing>.<verb>", e.g. "floor.background.upload"
//   entityType / entityId: what it was done to ("DiningArea", its id)
//   meta: the details worth keeping (file size, before/after…)
export type AuditEntry = {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
};

export async function writeAudit(entry: AuditEntry, db: Prisma.TransactionClient | PrismaClient = prisma): Promise<void> {
  await db.auditLog.create({
    data: { userId: entry.userId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, meta: entry.meta },
  });
}
