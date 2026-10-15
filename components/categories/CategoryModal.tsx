"use client";

import MasterDataFormModal from "@/components/ui/MasterDataFormModal";
import { createCategory, updateCategory } from "@/app/(dashboard)/product-categories/actions";
import type { PublicCategory } from "@/app/(dashboard)/product-categories/queries";

export default function CategoryModal({
  category,
  onClose,
}: {
  category: PublicCategory | null;
  onClose: () => void;
}) {
  return (
    <MasterDataFormModal
      item={category}
      titleCreate="Create Product Category"
      titleEdit="Edit Product Category"
      logoHint="category logo · 400×400 png"
      onClose={onClose}
      onSubmit={(formData) => (category ? updateCategory(category.id, formData) : createCategory(formData))}
      successMessageCreate="Product category created successfully."
      successMessageEdit="Product category updated successfully."
    />
  );
}
