import "server-only";
import type { Prisma } from "@prisma/client";

// Row locks for actions that check before they write. Each takes the row
// FOR UPDATE (held until the transaction ends) and returns null when the row
// is missing or soft-deleted, so the check and the lock are one query.

export async function lockWarehouse(tx: Prisma.TransactionClient, id: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM Warehouse WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function lockArea(tx: Prisma.TransactionClient, id: string): Promise<{ warehouseId: string } | null> {
  const rows = await tx.$queryRaw<{ warehouseId: string }[]>`
    SELECT warehouseId FROM DiningArea WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function lockTable(tx: Prisma.TransactionClient, id: string): Promise<{ areaId: string; name: string } | null> {
  const rows = await tx.$queryRaw<{ areaId: string; name: string }[]>`
    SELECT areaId, name FROM \`Table\` WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function lockStation(tx: Prisma.TransactionClient, id: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM KitchenStation WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

// A menu item (Product with productType MENU_ITEM).
export async function lockMenuItem(tx: Prisma.TransactionClient, id: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM Product WHERE id = ${id} AND productType = 'MENU_ITEM' AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function lockModifierGroup(tx: Prisma.TransactionClient, id: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ModifierGroup WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}

export async function lockModifier(tx: Prisma.TransactionClient, id: string): Promise<{ groupId: string } | null> {
  const rows = await tx.$queryRaw<{ groupId: string }[]>`
    SELECT groupId FROM Modifier WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows[0] ?? null;
}
