"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field } from "@/components/purchases/form-fields";
import { COLORS } from "@/components/layout/theme";
import { LATE_AFTER_MAX, STATION_NAME_MAX, type StationField } from "../../schemas/station";
import { createStation, updateStation } from "../../server/actions/stations";
import TextInput from "../TextInput";

export type EditableStation = { id: string; name: string; code: string; lateAfterMin: number; sortOrder: number; isActive: boolean };

// Add / edit a kitchen station in the shared modal shell. The server
// validates and checks the code is free.
export default function StationModal({ station, nextSortOrder, onClose }: { station: EditableStation | null; nextSortOrder: number; onClose: () => void }) {
  const [name, setName] = useState(station?.name ?? "");
  const [code, setCode] = useState(station?.code ?? "");
  const [lateAfterMin, setLateAfterMin] = useState(String(station?.lateAfterMin ?? 15));
  const [sortOrder, setSortOrder] = useState(String(station?.sortOrder ?? nextSortOrder));
  const [isActive, setIsActive] = useState(station?.isActive ?? true);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<StationField, string[]>>>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { name, code, lateAfterMin, sortOrder, isActive };
      const result = station ? await updateStation(station.id, input) : await createStation(input);
      if (result.ok) {
        toast.success(station ? "Station updated." : "Station added.");
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <MasterDataModal
      title={station ? "Edit station" : "Add station"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={station ? "Save" : "Add station"}
    >
      <Field label="Name" required error={fieldErrors.name?.[0]}>
        <TextInput value={name} onChange={setName} placeholder="e.g. Grill" maxLength={STATION_NAME_MAX} hasError={!!fieldErrors.name} ariaLabel="Name" autoFocus />
      </Field>
      <Field label="Code" required error={fieldErrors.code?.[0]}>
        <TextInput value={code} onChange={(value) => setCode(value.toUpperCase())} placeholder="e.g. GRL" maxLength={6} hasError={!!fieldErrors.code} ariaLabel="Code" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Late after (minutes)" required error={fieldErrors.lateAfterMin?.[0]}>
          <TextInput value={lateAfterMin} onChange={setLateAfterMin} inputMode="numeric" maxLength={String(LATE_AFTER_MAX).length} hasError={!!fieldErrors.lateAfterMin} ariaLabel="Late after (minutes)" />
        </Field>
        <Field label="Sort order" error={fieldErrors.sortOrder?.[0]}>
          <TextInput value={sortOrder} onChange={setSortOrder} inputMode="numeric" maxLength={3} hasError={!!fieldErrors.sortOrder} ariaLabel="Sort order" />
        </Field>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text, cursor: "pointer" }}>
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} aria-label="Active" style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
        Active — shown on the kitchen display and sent tickets
      </label>
    </MasterDataModal>
  );
}
