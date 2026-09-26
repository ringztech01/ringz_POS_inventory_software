import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type SupplierListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

export async function getSupplierList({ q, page = 1, perPage = 10 }: SupplierListParams) {
  const where: Prisma.SupplierWhereInput = {
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

  const [total, suppliers] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { suppliers, total };
}

export async function getSupplierById(id: string) {
  return prisma.supplier.findFirst({
    where: { id, deletedAt: null },
  });
}

// No modules reference Supplier yet — Purchases doesn't exist in the schema
// yet. When it does, it'll get a `supplierId` foreign key — add a
// `prisma.purchase.count({ where: { supplierId: id } })` check here and
// return true if it's non-zero. Until then, nothing can actually be "in
// use", so this always reports false.
export async function isSupplierInUse(id: string): Promise<boolean> {
  void id;
  return false;
}
