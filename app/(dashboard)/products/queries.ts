import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ProductListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  code: true,
  price: true,
  images: true,
  createdAt: true,
  brand: { select: { name: true } },
  unit: { select: { name: true } },
} satisfies Prisma.ProductSelect;

type ProductListPayload = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

export type ProductListRow = Omit<ProductListPayload, "price"> & {
  price: number;
  stock: number;
};

export async function getProductList({ q, page = 1, perPage = 10 }: ProductListParams) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [{ name: { contains: q } }, { code: { contains: q } }],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: PRODUCT_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // "In stock" is never a column — it's the sum of this product's
  // ProductStock ledger rows across every warehouse.
  const stockSums = await prisma.productStock.groupBy({
    by: ["productId"],
    where: { productId: { in: products.map((product) => product.id) } },
    _sum: { quantity: true },
  });
  const stockByProduct = new Map(stockSums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  const rows: ProductListRow[] = products.map((product) => ({
    ...product,
    price: Number(product.price),
    stock: stockByProduct.get(product.id) ?? 0,
  }));

  return { products: rows, total };
}

export async function getProductFormOptions() {
  const [categories, brands, units, warehouses, suppliers] = await Promise.all([
    prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return { categories, brands, units, warehouses, suppliers };
}

export async function getProductById(id: string) {
  return prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: { category: true, brand: true, unit: true },
  });
}

export async function getProductStockBreakdown(productId: string) {
  const sums = await prisma.productStock.groupBy({
    by: ["warehouseId"],
    where: { productId },
    _sum: { quantity: true },
  });

  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: sums.map((row) => row.warehouseId) } },
    select: { id: true, name: true },
  });
  const warehouseNameById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));

  return sums.map((row) => ({
    warehouseId: row.warehouseId,
    warehouseName: warehouseNameById.get(row.warehouseId) ?? "Unknown warehouse",
    quantity: row._sum.quantity ?? 0,
  }));
}

// No PurchaseItem/SaleItem/TransferItem models exist yet, so nothing can
// actually reference a product through those modules. When Purchases, Sales
// and Transfers exist, replace this with the sum of their three counts for
// this productId — the delete guard in actions.ts calls this same function,
// so upgrading it here is enough to make that guard real.
export async function countProductReferences(id: string): Promise<number> {
  void id;
  return 0;
}
