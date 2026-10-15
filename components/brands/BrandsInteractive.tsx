"use client";

import { Tags } from "lucide-react";
import MasterDataListPage from "@/components/ui/MasterDataListPage";
import BrandModal from "./BrandModal";
import DeleteBrandButton from "./DeleteBrandButton";
import type { PublicBrand } from "@/app/(dashboard)/brands/queries";

export default function BrandsInteractive({
  brands,
  total,
  page,
  perPage,
  totalPages,
}: {
  brands: PublicBrand[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  return (
    <MasterDataListPage<PublicBrand>
      title="Brands"
      entityNameSingular="brand"
      entityNamePlural="brands"
      createLabel="Create Brand"
      columnLabel="Brand"
      emptyIcon={Tags}
      emptyMessage="No brands found."
      items={brands}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
      renderDelete={(brand) => <DeleteBrandButton id={brand.id} name={brand.name} />}
      renderModal={(modal, close) => <BrandModal brand={modal.item} onClose={close} />}
    />
  );
}
