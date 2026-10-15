import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CategoryListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const CATEGORY_SELECT = {
  id: true,
  name: true,
  logo: true,
  createdAt: true,
} satisfies Prisma.CategorySelect;

export type PublicCategory = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }> & {
  products: number;
};

export async function getCategoryList({ q, page = 1, perPage = 10 }: CategoryListParams) {
  const where: Prisma.CategoryWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
  };

  const [total, categories] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const withProductCounts: PublicCategory[] = await Promise.all(
    categories.map(async (category) => ({
      ...category,
      products: await countActiveProductsInCategory(category.id),
    })),
  );

  return { categories: withProductCounts, total };
}

export async function getCategoryById(id: string) {
  return prisma.category.findFirst({ where: { id, deletedAt: null } });
}

export async function countActiveProductsInCategory(id: string): Promise<number> {
  return prisma.product.count({ where: { categoryId: id, deletedAt: null } });
}
