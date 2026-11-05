"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field } from "@/components/purchases/form-fields";
import { COLORS } from "@/components/layout/theme";
import { groupRuleLabel, groupType } from "../../lib/modifiers";
import { GROUP_NAME_MAX, MAX_SELECTIONS, type ModifierGroupField } from "../../schemas/modifierGroup";
import { createModifierGroup, updateModifierGroup } from "../../server/actions/modifierGroups";
import type { ModifierGroupRow } from "../../server/queries/modifierGroups";
import TextInput from "../TextInput";

// Add / edit a modifier group. Required and the minimum go together: switching
// Required on makes the minimum at least 1, off makes it 0. The server
// validates again and checks the name is free.
export default function ModifierGroupModal({ group, onClose }: { group: ModifierGroupRow | null; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [minSelect, setMinSelect] = useState(String(group?.minSelect ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(group?.maxSelect ?? 1));
  const [required, setRequired] = useState(group?.required ?? false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ModifierGroupField, string[]>>>({});
  const [isPending, startTransition] = useTransition();

  function toggleRequired(on: boolean) {
    setRequired(on);
    const min = Number(minSelect) || 0;
    setMinSelect(on ? String(Math.max(1, min)) : "0");
  }

  const min = Number(minSelect);
  const max = Number(maxSelect);
  const preview = Number.isInteger(min) && Number.isInteger(max) && max >= 1 && min <= max ? `${groupType(max)} · ${groupRuleLabel(min, max)}` : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { name, minSelect, maxSelect, required };
      const result = group ? await updateModifierGroup(group.id, input) : await createModifierGroup(input);
      if (result.ok) {
        toast.success(group ? `${name.trim()} saved.` : `${name.trim()} added.`);
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  return (
    <MasterDataModal
      title={group ? "Edit modifier group" : "Add modifier group"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={group ? "Save" : "Add group"}
    >
      <Field label="Name" required error={fieldErrors.name?.[0]}>
        <TextInput value={name} onChange={setName} placeholder="e.g. Portion" maxLength={GROUP_NAME_MAX} hasError={!!fieldErrors.name} ariaLabel="Name" autoFocus />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: COLORS.text, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(event) => toggleRequired(event.target.checked)}
          aria-label="Required"
          style={{ width: 16, height: 16, accentColor: COLORS.teal }}
        />
        Required — guests must choose at least one
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Min selections" required error={fieldErrors.minSelect?.[0]}>
          <TextInput value={minSelect} onChange={setMinSelect} inputMode="numeric" maxLength={2} hasError={!!fieldErrors.minSelect} ariaLabel="Min selections" />
        </Field>
        <Field label="Max selections" required error={fieldErrors.maxSelect?.[0]}>
          <TextInput value={maxSelect} onChange={setMaxSelect} inputMode="numeric" maxLength={2} hasError={!!fieldErrors.maxSelect} ariaLabel="Max selections" />
        </Field>
      </div>
      <p data-rule-preview style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>
        {preview ? `On the order screen: ${preview}.` : `Between 0 and ${MAX_SELECTIONS}; the minimum can't be more than the maximum.`}
      </p>
    </MasterDataModal>
  );
}
