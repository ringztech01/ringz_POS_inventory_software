import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { firstFreeSlot, round2, shapeForSeats } from "../../lib/floorGeometry";
import { newQrToken } from "../../lib/qrToken";

// Gives an active table a new QR token, so the old printed code's link
// (/menu/<old token>) stops working at once, and notes when (qrRotatedAt).
// False when the table is missing or deleted. The unique index on
// Table.qrToken backs up the token's randomness.
export async function replaceQrToken(tableId: string): Promise<boolean> {
  const { count } = await prisma.table.updateMany({
    where: { id: tableId, deletedAt: null },
    data: { qrToken: newQrToken(), qrRotatedAt: new Date() },
  });
  return count > 0;
}

// A table new to an area: shaped by its seats, in the first free grid slot
// of the floor plan; the room grows if that's below it. The area's layout
// version moves on, so a floor plan editor open meanwhile knows.
export async function placeInArea(tx: Prisma.TransactionClient, areaId: string, seats: number, exceptId?: string) {
  const [area, others] = await Promise.all([
    tx.diningArea.findUniqueOrThrow({ where: { id: areaId }, select: { roomHeightM: true } }),
    tx.table.findMany({ where: { areaId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { x: true, y: true, w: true, h: true } }),
  ]);
  const { shape, w, h } = shapeForSeats(seats);
  const spot = firstFreeSlot(others.map((t) => ({ x: Number(t.x), y: Number(t.y), w: Number(t.w), h: Number(t.h) })), w, h);
  const deep = round2(spot.y + h + 0.4);
  await tx.diningArea.update({
    where: { id: areaId },
    data: { layoutVersion: { increment: 1 }, ...(deep > Number(area.roomHeightM) ? { roomHeightM: deep } : {}) },
  });
  return { shape, w, h, x: spot.x, y: spot.y, rotation: 0 };
}
