"use client";

import MasterDataFormModal from "@/components/ui/MasterDataFormModal";
import { createUnit, updateUnit } from "@/app/(dashboard)/units/actions";
import type { PublicUnit } from "@/app/(dashboard)/units/queries";

export default function UnitModal({ unit, onClose }: { unit: PublicUnit | null; onClose: () => void }) {
  return (
    <MasterDataFormModal
      item={unit}
      titleCreate="Create Unit"
      titleEdit="Edit Unit"
      showLogo={false}
      onClose={onClose}
      onSubmit={(formData) => (unit ? updateUnit(unit.id, formData) : createUnit(formData))}
      successMessageCreate="Unit created successfully."
      successMessageEdit="Unit updated successfully."
    />
  );
}
