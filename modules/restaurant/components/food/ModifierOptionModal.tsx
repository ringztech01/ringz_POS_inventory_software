"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { COLORS } from "@/components/layout/theme";
import { priceChangeLabel } from "../../lib/modifiers";
import { MODIFIER_NAME_MAX, type ModifierField } from "../../schemas/modifier";
import { createModifier, updateModifier } from "../../server/actions/modifiers";
import type { ModifierGroupOption, ModifierRow } from "../../server/queries/modifierList";
import TextInput from "../TextInput";

// Add / edit a modifier. It belongs to one group at a time; the Group select
// switches which one without closing the pop-up (editing an existing one
// moves it there). The server checks the name is free in that group.
export default function ModifierOptionModal({
  modifier,
  groupId,
  groups,
  onClose,
}: {
  modifier: ModifierRow | null;
  groupId: string;
  groups: ModifierGroupOption[];
  onClose: () => void;
}) {
  const [group, setGroup] = useState(modifier?.groupId ?? groupId);
  const [name, setName] = useState(modifier?.name ?? "");
  const [price, setPrice] = useState(modifier ? modifier.price : "0");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ModifierField, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const groupName = groups.find((g) => g.id === group)?.name ?? "";
  const shown = /^-?\d+(\.\d{1,2})?$/.test(price.trim()) ? priceChangeLabel(price.trim()) : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { groupId: group, name, price };
      const result = modifier ? await updateModifier(modifier.id, input) : await createModifier(input);
      if (result.ok) {
        toast.success(modifier ? `${name.trim()} saved.` : `${name.trim()} added to ${groupName}.`);
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <MasterDataModal
      title={modifier ? "Edit modifier" : "Add modifier"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={modifier ? "Save" : "Add modifier"}
    >
      <Field label="Group" required error={fieldErrors.groupId?.[0]}>
        <SelectInput value={group} onChange={setGroup} options={groups.map((g) => ({ value: g.id, label: g.name }))} hasError={!!fieldErrors.groupId} />
      </Field>
      <Field label="Name" required error={fieldErrors.name?.[0]}>
        <TextInput value={name} onChange={setName} placeholder="e.g. Large" maxLength={MODIFIER_NAME_MAX} hasError={!!fieldErrors.name} ariaLabel="Name" autoFocus />
      </Field>
      <Field label="Price change (₦)" error={fieldErrors.price?.[0]}>
        <TextInput value={price} onChange={setPrice} placeholder="0" maxLength={12} hasError={!!fieldErrors.price} ariaLabel="Price change" />
      </Field>
      <p data-price-preview style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>
        {shown ? `Shown on the order screen as ${shown === "No change" ? "no price change" : shown}. Use a minus for a discount.` : "Enter an amount like 2, 2.50 or -1."}
      </p>
    </MasterDataModal>
  );
}
