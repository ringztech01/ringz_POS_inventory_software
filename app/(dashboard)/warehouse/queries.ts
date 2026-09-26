import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type WarehouseListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

export async function getWarehouseList({ q, page = 1, perPage = 10 }: WarehouseListParams) {
  const where: Prisma.WarehouseWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { city: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, warehouses] = await Promise.all([
    prisma.warehouse.count({ where }),
    prisma.warehouse.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { warehouses, total };
}

export async function getWarehouseById(id: string) {
  return prisma.warehouse.findFirst({
    where: { id, deletedAt: null },
  });
}

// No modules reference Warehouse yet — Stock, Sales, and Purchases don't
// exist in the schema yet. When one of them gets a `warehouseId` foreign
// key, add a `prisma.<model>.count({ where: { warehouseId: id } })` check
// here and return true if any of them is non-zero. Until then, nothing can
// actually be "in use", so this always reports false.
export async function isWarehouseInUse(id: string): Promise<boolean> {
  void id;
  return false;
}
