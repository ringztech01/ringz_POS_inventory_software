import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

// Lines in a station's kitchen right now: sent there and Sent, Preparing or
// Ready, not cancelled or removed, on a live order.
export function openLinesAt(db: Prisma.TransactionClient | PrismaClient, stationId: string): Promise<number> {
  return db.orderItem.count({
    where: {
      stationId,
      kitchenStatus: { in: ["PENDING", "PREPARING", "READY"] },
      deletedAt: null,
      cancelledAt: null,
      order: { deletedAt: null, status: { in: ["OPEN", "SENT", "SERVED"] } },
    },
  });
}
