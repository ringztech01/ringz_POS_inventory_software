import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import ProductForm from "@/components/products/ProductForm";
import { getProductFormOptions } from "../queries";

export default async function CreateProductPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_PRODUCTS);
  if (denied) return denied;

  const { categories, brands, units, warehouses, suppliers } = await getProductFormOptions();

  return (
    <ProductForm categories={categories} brands={brands} units={units} warehouses={warehouses} suppliers={suppliers} />
  );
}
