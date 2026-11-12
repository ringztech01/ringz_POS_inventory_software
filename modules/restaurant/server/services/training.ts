import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// Training mode on or off for someone (Part 6f Step 7f; Settings › Staff,
// Administrator only). Logged. Their open orders keep what they are.
export async function setTrainingMode(input: { id: string; on: boolean }, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findFirst({ where: { id: input.id, deletedAt: null }, select: { firstName: true, lastName: true, trainingMode: true } });
  if (!user) return { ok: false, error: "That person has been removed. Reload the page." };
  if (user.trainingMode === input.on) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.id }, data: { trainingMode: input.on } });
    await writeAudit({ userId: actorId, action: input.on ? "staff.training.on" : "staff.training.off", entityType: "User", entityId: input.id, meta: { name: `${user.firstName} ${user.lastName}`.trim() } }, tx);
  });
  return { ok: true };
}
