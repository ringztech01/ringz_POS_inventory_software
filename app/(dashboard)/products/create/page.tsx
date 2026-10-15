import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ProductForm from "@/components/products/ProductForm";
import { getProductFormOptions } from "../queries";

export default async function CreateProductPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const { categories, brands, units, warehouses, suppliers } = await getProductFormOptions();

  return (
    <ProductForm categories={categories} brands={brands} units={units} warehouses={warehouses} suppliers={suppliers} />
  );
}
