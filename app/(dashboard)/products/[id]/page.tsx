import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { FONTS } from "@/components/layout/theme";
import DetailView from "@/components/ui/DetailView";
import ProductImageGallery from "@/components/products/ProductImageGallery";
import ProductStockTable from "@/components/products/ProductStockTable";
import { formatDateTime, formatNaira } from "@/lib/format";
import { getProductById, getProductStockBreakdown } from "../queries";

const TAX_TYPE_LABELS: Record<string, string> = {
  EXCLUSIVE: "Exclusive",
  INCLUSIVE: "Inclusive",
};

function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: FONTS.mono }}>{children}</span>;
}

export default async function ProductViewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const stockBreakdown = await getProductStockBreakdown(id);
  const images = Array.isArray(product.images)
    ? product.images.filter((value): value is string => typeof value === "string")
    : [];
  const { date, time } = formatDateTime(product.createdAt);

  return (
    <DetailView
      title={product.name}
      subtitle={`Code ${product.code}`}
      backHref="/products"
      editHref={`/products/${product.id}/edit`}
      gallery={<ProductImageGallery images={images} />}
      sections={[
        {
          fields: [
            { label: "Name", value: product.name },
            { label: "Code", value: <Mono>{product.code}</Mono> },
            { label: "Category", value: product.category.name },
            { label: "Brand", value: product.brand.name },
            { label: "Price", value: <Mono>{formatNaira(Number(product.price))}</Mono> },
            { label: "Cost", value: product.cost != null ? <Mono>{formatNaira(product.cost.toFixed(2))}</Mono> : "—" },
            { label: "Product unit", value: product.unit.name },
            { label: "Tax type", value: TAX_TYPE_LABELS[product.taxType] ?? product.taxType },
            {
              label: "Order tax",
              value: product.orderTax != null ? <Mono>{Number(product.orderTax)}%</Mono> : "—",
            },
            { label: "Stock alert", value: product.stockAlert != null ? <Mono>{product.stockAlert}</Mono> : "—" },
            {
              label: "Quantity limitation",
              value: product.quantityLimitation != null ? <Mono>{product.quantityLimitation}</Mono> : "—",
            },
            { label: "Created on", value: <Mono>{date} · {time}</Mono> },
            { label: "Notes", value: product.notes || "—", wide: true },
          ],
        },
      ]}
      extra={<ProductStockTable breakdown={stockBreakdown} />}
    />
  );
}
