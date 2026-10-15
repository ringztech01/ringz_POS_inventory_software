import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type UnitListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const UNIT_SELECT = {
  id: true,
  name: true,
  createdAt: true,
} satisfies Prisma.UnitSelect;

export type PublicUnit = Prisma.UnitGetPayload<{ select: typeof UNIT_SELECT }> & {
  products: number;
};

export async function getUnitList({ q, page = 1, perPage = 10 }: UnitListParams) {
  const where: Prisma.UnitWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
  };

  const [total, units] = await Promise.all([
    prisma.unit.count({ where }),
    prisma.unit.findMany({
      where,
      select: UNIT_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const withProductCounts: PublicUnit[] = await Promise.all(
    units.map(async (unit) => ({
      ...unit,
      products: await countActiveProductsInUnit(unit.id),
    })),
  );

  return { units: withProductCounts, total };
}

export async function getUnitById(id: string) {
  return prisma.unit.findFirst({ where: { id, deletedAt: null } });
}

export async function countActiveProductsInUnit(id: string): Promise<number> {
  return prisma.product.count({ where: { unitId: id, deletedAt: null } });
}
