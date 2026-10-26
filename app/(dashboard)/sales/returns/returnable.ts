import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

// How much of each of a sale's lines its ACTIVE returns have already taken
// back, keyed by saleItemId. `excludeReturnId` leaves one return out — when
// editing a return, its own quantities count as available again.
//
//   returnable(line) = sold qty − returnedBySaleItem(line)
//
// Pass a transaction client to read it inside the save transaction (Step 3
// re-checks "not more than was sold" there, against concurrent returns).
export async function returnedBySaleItem(db: Db, saleId: string, excludeReturnId?: string): Promise<Map<string, number>> {
  const rows = await db.saleReturnItem.groupBy({
    by: ["saleItemId"],
    where: {
      saleReturn: { saleId, deletedAt: null, ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}) },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
}

// Row-locks the sale (SELECT … FOR UPDATE) until the transaction ends, so
// returns of the same sale — and edits/deletes of the sale itself — run one
// at a time. Call it FIRST in the transaction: under MySQL REPEATABLE READ a
// transaction's snapshot starts at its first plain read, so reads made after
// the lock see every return committed by whoever held it before. Without
// this, two concurrent returns could both see "3 left" and return 3 each.
// Returns false if the sale doesn't exist or is soft-deleted.
export async function lockSaleRow(tx: Prisma.TransactionClient, saleId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Sale WHERE id = ${saleId} AND deletedAt IS NULL FOR UPDATE`;
  return rows.length > 0;
}
