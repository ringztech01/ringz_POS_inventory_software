"use client";

import MasterDataFormModal from "@/components/ui/MasterDataFormModal";
import { createBrand, updateBrand } from "@/app/(dashboard)/brands/actions";
import type { PublicBrand } from "@/app/(dashboard)/brands/queries";

export default function BrandModal({ brand, onClose }: { brand: PublicBrand | null; onClose: () => void }) {
  return (
    <MasterDataFormModal
      item={brand}
      titleCreate="Create Brand"
      titleEdit="Edit Brand"
      logoHint="brand logo · 400×400 png"
      onClose={onClose}
      onSubmit={(formData) => (brand ? updateBrand(brand.id, formData) : createBrand(formData))}
      successMessageCreate="Brand created successfully."
      successMessageEdit="Brand updated successfully."
    />
  );
}
