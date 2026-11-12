import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { cardHash, cardLabel, normaliseCard } from "@/lib/auth/staffCard";

// Staff cards (Part 6f Step 7d; Settings › Staff, Administrator only): give
// someone a card — read by the scanner, or its number typed — or take it
// away. One person per card; the code itself is never kept. Logged, never
// the code.

type Done = { ok: true; label: string | null } | { ok: false; error: string };

export async function setStaffCard(input: { id: string; code: string }, actorId: string): Promise<Done> {
  const code = normaliseCard(input.code);
  if (!code) return { ok: false, error: "That isn't a card number: 4 to 64 letters, digits or symbols." };
  const hash = cardHash(code);
  if (!hash) return { ok: false, error: "Staff cards need NEXTAUTH_SECRET in .env." };
  return prisma.$transaction(async (tx): Promise<Done> => {
    const user = await tx.user.findFirst({ where: { id: input.id, deletedAt: null }, select: { firstName: true, lastName: true } });
    if (!user) return { ok: false, error: "That person has been removed. Reload the page." };
    const holder = await tx.user.findFirst({ where: { cardHash: hash }, select: { id: true, firstName: true, lastName: true, deletedAt: true } });
    if (holder && holder.id !== input.id) {
      if (!holder.deletedAt) return { ok: false, error: `That card is ${holder.firstName} ${holder.lastName}'s. Take it off them first.`.replace(" 's", "'s") };
      await tx.user.update({ where: { id: holder.id }, data: { cardHash: null, cardLabel: null, cardSetAt: null } });
    }
    const label = cardLabel(code);
    await tx.user.update({ where: { id: input.id }, data: { cardHash: hash, cardLabel: label, cardSetAt: new Date() } });
    await writeAudit({ userId: actorId, action: "staff.card.set", entityType: "User", entityId: input.id, meta: { name: `${user.firstName} ${user.lastName}`.trim(), card: label } }, tx);
    return { ok: true, label };
  });
}

export async function removeStaffCard(id: string, actorId: string): Promise<Done> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { firstName: true, lastName: true, cardLabel: true } });
  if (!user) return { ok: false, error: "That person has been removed. Reload the page." };
  if (!user.cardLabel) return { ok: true, label: null };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { cardHash: null, cardLabel: null, cardSetAt: null } });
    await writeAudit({ userId: actorId, action: "staff.card.remove", entityType: "User", entityId: id, meta: { name: `${user.firstName} ${user.lastName}`.trim(), card: user.cardLabel } }, tx);
  });
  return { ok: true, label: null };
}

// Whose card is this — among `where` (who may sign in here)? null: nobody's.
export async function findByCard(code: unknown, where: import("@prisma/client").Prisma.UserWhereInput, db: import("@prisma/client").Prisma.TransactionClient | typeof prisma = prisma): Promise<{ id: string; firstName: string } | null> {
  const normal = normaliseCard(code);
  const hash = normal ? cardHash(normal) : null;
  if (!hash) return null;
  return db.user.findFirst({ where: { AND: [{ cardHash: hash }, where] }, select: { id: true, firstName: true } });
}
