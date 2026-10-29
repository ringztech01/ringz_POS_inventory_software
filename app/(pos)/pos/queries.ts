import "server-only";
import { prisma } from "@/lib/db";
import { getStockByProduct } from "@/app/(dashboard)/purchases/product-search";
import type { PosOption, PosProduct } from "./types";

function firstImage(images: unknown): string | null {
  return Array.isArray(images) && typeof images[0] === "string" ? images[0] : null;
}

// The grid for one warehouse: every live product (out-of-stock ones too, so
// the cashier sees them), each with that warehouse's current stock. Search,
// category and brand filter this list on the client.
export async function getPosCatalog(warehouseId: string): Promise<PosProduct[]> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      price: true,
      taxType: true,
      orderTax: true,
      images: true,
      categoryId: true,
      brandId: true,
      unit: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const stockByProduct = await getStockByProduct(
    warehouseId,
    products.map((product) => product.id),
  );

  return products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    price: product.price.toFixed(2),
    taxType: product.taxType,
    orderTax: (product.orderTax ?? 0).toString(),
    unitName: product.unit.name,
    categoryId: product.categoryId,
    brandId: product.brandId,
    image: firstImage(product.images),
    stock: stockByProduct.get(product.id) ?? 0,
  }));
}

// The chips: live categories and brands.
export async function getPosFilters(): Promise<{ categories: PosOption[]; brands: PosOption[] }> {
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { categories, brands };
}

export async function isActiveWarehouse(warehouseId: string): Promise<boolean> {
  return (await prisma.warehouse.count({ where: { id: warehouseId, deletedAt: null } })) > 0;
}
