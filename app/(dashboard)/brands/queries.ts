import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type BrandListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const BRAND_SELECT = {
  id: true,
  name: true,
  logo: true,
  createdAt: true,
} satisfies Prisma.BrandSelect;

export type PublicBrand = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }> & {
  products: number;
};

export async function getBrandList({ q, page = 1, perPage = 10 }: BrandListParams) {
  const where: Prisma.BrandWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
  };

  const [total, brands] = await Promise.all([
    prisma.brand.count({ where }),
    prisma.brand.findMany({
      where,
      select: BRAND_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const withProductCounts: PublicBrand[] = await Promise.all(
    brands.map(async (brand) => ({
      ...brand,
      products: await countActiveProductsInBrand(brand.id),
    })),
  );

  return { brands: withProductCounts, total };
}

export async function getBrandById(id: string) {
  return prisma.brand.findFirst({ where: { id, deletedAt: null } });
}

export async function countActiveProductsInBrand(id: string): Promise<number> {
  return prisma.product.count({ where: { brandId: id, deletedAt: null } });
}
