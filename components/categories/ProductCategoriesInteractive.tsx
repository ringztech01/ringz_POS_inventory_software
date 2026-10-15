"use client";

import { Tag } from "lucide-react";
import MasterDataListPage from "@/components/ui/MasterDataListPage";
import CategoryModal from "./CategoryModal";
import DeleteCategoryButton from "./DeleteCategoryButton";
import type { PublicCategory } from "@/app/(dashboard)/product-categories/queries";

export default function ProductCategoriesInteractive({
  categories,
  total,
  page,
  perPage,
  totalPages,
}: {
  categories: PublicCategory[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  return (
    <MasterDataListPage<PublicCategory>
      title="Product Categories"
      entityNameSingular="category"
      entityNamePlural="categories"
      createLabel="Create Product Category"
      columnLabel="Product category"
      emptyIcon={Tag}
      emptyMessage="No product categories found."
      items={categories}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
      renderDelete={(category) => <DeleteCategoryButton id={category.id} name={category.name} />}
      renderModal={(modal, close) => <CategoryModal category={modal.item} onClose={close} />}
    />
  );
}
