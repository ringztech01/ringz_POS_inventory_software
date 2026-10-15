"use client";

import { Ruler } from "lucide-react";
import MasterDataListPage from "@/components/ui/MasterDataListPage";
import UnitModal from "./UnitModal";
import DeleteUnitButton from "./DeleteUnitButton";
import type { PublicUnit } from "@/app/(dashboard)/units/queries";

export default function UnitsInteractive({
  units,
  total,
  page,
  perPage,
  totalPages,
}: {
  units: PublicUnit[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  return (
    <MasterDataListPage<PublicUnit>
      title="Units"
      entityNameSingular="unit"
      entityNamePlural="units"
      createLabel="Create Unit"
      columnLabel="Unit"
      emptyIcon={Ruler}
      emptyMessage="No units found."
      showLogo={false}
      items={units}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
      renderDelete={(unit) => <DeleteUnitButton id={unit.id} name={unit.name} />}
      renderModal={(modal, close) => <UnitModal unit={modal.item} onClose={close} />}
    />
  );
}
