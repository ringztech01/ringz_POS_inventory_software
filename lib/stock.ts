import type { Prisma } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export class InsufficientStockError extends Error {
  constructor(
    public readonly productName: string,
    public readonly warehouseName: string,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(`Not enough stock for ${productName} in ${warehouseName} (have ${available}, subtracting ${requested}).`);
    this.name = "InsufficientStockError";
  }
}

export async function getStockQuantity(tx: TxClient, productId: string, warehouseId: string): Promise<number> {
  const row = await tx.productStock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  return row?.quantity ?? 0;
}

// Every stock change — initial quantity on product create, Adjustments, and
// eventually Purchases/Transfers — goes through this pair of helpers inside
// a transaction. ProductStock holds exactly one row per (productId,
// warehouseId); these upsert/increment it rather than inserting new rows.
export async function increaseStock(
  tx: TxClient,
  params: { productId: string; warehouseId: string; quantity: number; supplierId?: string; status?: string },
): Promise<void> {
  await tx.productStock.upsert({
    where: { productId_warehouseId: { productId: params.productId, warehouseId: params.warehouseId } },
    create: {
      productId: params.productId,
      warehouseId: params.warehouseId,
      quantity: params.quantity,
      supplierId: params.supplierId,
      status: params.status,
    },
    update: {
      quantity: { increment: params.quantity },
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
  });
}

// Throws InsufficientStockError (and lets the caller's transaction roll
// back) rather than ever letting a balance go negative.
//
// The check and the decrement are a single conditional UPDATE
// (... WHERE quantity >= n), which the database applies atomically under a
// row lock. A separate read-then-update could let two concurrent
// transactions both pass the check and drive the balance below zero.
export async function decreaseStock(
  tx: TxClient,
  params: { productId: string; warehouseId: string; quantity: number; productName: string; warehouseName: string },
): Promise<void> {
  const { count } = await tx.productStock.updateMany({
    where: { productId: params.productId, warehouseId: params.warehouseId, quantity: { gte: params.quantity } },
    data: { quantity: { decrement: params.quantity } },
  });

  if (count === 0) {
    const current = await getStockQuantity(tx, params.productId, params.warehouseId);
    throw new InsufficientStockError(params.productName, params.warehouseName, current, params.quantity);
  }
}
