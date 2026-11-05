import "server-only";
import { prisma } from "@/lib/db";
import { newQrToken } from "../../lib/qrToken";

// Gives an active table a new QR token, so the old printed code's link
// (/menu/<old token>) stops working at once. False when the table is
// missing or deleted. The unique index on Table.qrToken backs up the
// token's randomness.
export async function replaceQrToken(tableId: string): Promise<boolean> {
  const { count } = await prisma.table.updateMany({
    where: { id: tableId, deletedAt: null },
    data: { qrToken: newQrToken() },
  });
  return count > 0;
}
