import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import ProductForm from "@/components/products/ProductForm";
import { getProductById, getProductFormOptions, getProductStockBreakdown } from "../../queries";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const [{ categories, brands, units, warehouses, suppliers }, stockBreakdown] = await Promise.all([
    getProductFormOptions(),
    getProductStockBreakdown(id),
  ]);

  const images = Array.isArray(product.images)
    ? product.images.filter((value): value is string => typeof value === "string")
    : [];

  return (
    <ProductForm
      mode="edit"
      product={{
        id: product.id,
        name: product.name,
        code: product.code,
        categoryId: product.categoryId,
        brandId: product.brandId,
        unitId: product.unitId,
        price: Number(product.price),
        cost: product.cost?.toFixed(2) ?? null,
        stockAlert: product.stockAlert,
        orderTax: product.orderTax ? Number(product.orderTax) : null,
        taxType: product.taxType,
        quantityLimitation: product.quantityLimitation,
        notes: product.notes,
        images,
      }}
      stockBreakdown={stockBreakdown}
      categories={categories}
      brands={brands}
      units={units}
      warehouses={warehouses}
      suppliers={suppliers}
    />
  );
}
