"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput, type SelectOption } from "@/components/purchases/form-fields";
import { AREA_NAME_MAX, type DiningAreaField } from "../../schemas/diningArea";
import { createDiningArea, updateDiningArea } from "../../server/actions/diningAreas";
import TextInput from "../TextInput";

export type EditableArea = { id: string; name: string; warehouseId: string };

// Add / edit a dining area in the shared modal shell. The server validates,
// checks the name is unique in the warehouse and that the warehouse is active.
export default function DiningAreaModal({
  area,
  warehouses,
  onClose,
}: {
  area: EditableArea | null;
  warehouses: SelectOption[];
  onClose: () => void;
}) {
  const [name, setName] = useState(area?.name ?? "");
  // A deleted warehouse isn't offered, so its id would never match an option.
  const [warehouseId, setWarehouseId] = useState(() => {
    const current = area?.warehouseId ?? (warehouses.length === 1 ? warehouses[0].value : "");
    return warehouses.some((w) => w.value === current) ? current : "";
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DiningAreaField, string[]>>>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { name, warehouseId };
      const result = area ? await updateDiningArea(area.id, input) : await createDiningArea(input);
      if (result.ok) {
        toast.success(area ? "Dining area updated." : "Dining area added.");
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <MasterDataModal
      title={area ? "Edit dining area" : "Add dining area"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={area ? "Save" : "Add area"}
    >
      <Field label="Name" required error={fieldErrors.name?.[0]}>
        <TextInput
          value={name}
          onChange={setName}
          placeholder="e.g. Main hall"
          maxLength={AREA_NAME_MAX}
          hasError={!!fieldErrors.name}
          ariaLabel="Name"
          autoFocus
        />
      </Field>
      <Field label="Warehouse" required error={fieldErrors.warehouseId?.[0]}>
        <SelectInput
          value={warehouseId}
          onChange={setWarehouseId}
          options={warehouses}
          placeholder="Choose warehouse"
          hasError={!!fieldErrors.warehouseId}
        />
      </Field>
    </MasterDataModal>
  );
}
