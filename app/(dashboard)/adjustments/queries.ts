import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AdjustmentListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const ADJUSTMENT_LIST_SELECT = {
  id: true,
  reference: true,
  date: true,
  createdAt: true,
  warehouse: { select: { name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.AdjustmentSelect;

export type AdjustmentListRow = Prisma.AdjustmentGetPayload<{ select: typeof ADJUSTMENT_LIST_SELECT }>;

export async function getAdjustmentList({ q, page = 1, perPage = 10 }: AdjustmentListParams) {
  const where: Prisma.AdjustmentWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [{ reference: { contains: q } }, { warehouse: { name: { contains: q } } }],
        }
      : {}),
  };

  const [total, adjustments] = await Promise.all([
    prisma.adjustment.count({ where }),
    prisma.adjustment.findMany({
      where,
      select: ADJUSTMENT_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { adjustments, total };
}

export async function getActiveWarehouses() {
  return prisma.warehouse.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getAdjustmentById(id: string) {
  return prisma.adjustment.findFirst({
    where: { id, deletedAt: null },
    include: {
      warehouse: true,
      createdBy: { select: { firstName: true, lastName: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
}
