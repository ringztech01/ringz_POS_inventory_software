import "server-only";
import { prisma } from "@/lib/db";
import type { PurchaseProductSearchResult } from "./types";

export async function getStockByProduct(warehouseId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const stocks = await prisma.productStock.findMany({
    where: { warehouseId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  return new Map(stocks.map((row) => [row.productId, row.quantity]));
}

// "Search Product by Code Name" for the purchase document and sale forms. Callers
// check the session; this only queries.
//
// inStockOnly:
//   false (Purchase): any active product — a purchase is how new stock
//         arrives, so the product needn't be in the warehouse yet. Stock is
//         shown as a reference (0 when there's no ProductStock row).
//   true  (Return, Sale): only products with stock > 0 in the warehouse — you
//         can only return or sell what you hold.
export async function searchPurchaseProducts(
  warehouseId: string,
  query: string,
  { inStockOnly }: { inStockOnly: boolean },
): Promise<PurchaseProductSearchResult[]> {
  const trimmed = query.trim();
  if (!warehouseId || trimmed.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [{ name: { contains: trimmed } }, { code: { contains: trimmed } }],
      ...(inStockOnly ? { stocks: { some: { warehouseId, quantity: { gt: 0 } } } } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      cost: true,
      price: true,
      taxType: true,
      orderTax: true,
      unit: { select: { name: true } },
    },
    orderBy: { name: "asc" },
    take: 8,
  });

  const stockByProduct = await getStockByProduct(
    warehouseId,
    products.map((product) => product.id),
  );

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    code: product.code,
    unitName: product.unit.name,
    cost: product.cost?.toFixed(2) ?? "0.00",
    price: product.price.toFixed(2),
    taxType: product.taxType,
    orderTax: (product.orderTax ?? 0).toString(),
    stock: stockByProduct.get(product.id) ?? 0,
  }));
}
