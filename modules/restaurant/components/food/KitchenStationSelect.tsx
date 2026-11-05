"use client";

import { Field, SelectInput, type SelectOption } from "@/components/purchases/form-fields";

// The menu-item form's "Kitchen station" select (options from
// getStationOptions: the active stations). Empty means no station: the
// item's lines go to the first active station when sent.
export default function KitchenStationSelect({
  value,
  onChange,
  options,
  error,
}: {
  value: string;
  onChange: (stationId: string) => void;
  options: SelectOption[];
  error?: string;
}) {
  return (
    <Field label="Kitchen station" error={error}>
      <SelectInput value={value} onChange={onChange} options={options} placeholder="No station (first active station)" hasError={!!error} />
    </Field>
  );
}
