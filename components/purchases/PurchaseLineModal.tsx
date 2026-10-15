"use client";

import { useState, type FormEvent } from "react";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { toDecimal, type LineDiscountType, type LineTaxType } from "@/lib/pricing";
import { PURCHASE_UNITS } from "@/lib/purchase-units";
import { DecimalInput, Field, SelectInput, type SelectOption } from "./form-fields";
import type { PurchaseLine } from "./PurchaseForm";

const TAX_TYPE_OPTIONS: SelectOption[] = [
  { value: "INCLUSIVE", label: "Inclusive" },
  { value: "EXCLUSIVE", label: "Exclusive" },
];

const DISCOUNT_TYPE_OPTIONS: SelectOption[] = [
  { value: "FIXED", label: "Fixed" },
  { value: "PERCENTAGE", label: "Percentage" },
];

export type PurchaseLineEdit = Pick<
  PurchaseLine,
  "unitCost" | "taxType" | "taxRate" | "discountType" | "discount" | "purchaseUnit"
>;

type Errors = Partial<Record<"unitCost" | "taxRate" | "discount", string>>;

function validate(draft: PurchaseLineEdit): Errors {
  const errors: Errors = {};
  const cost = toDecimal(draft.unitCost);
  const discount = toDecimal(draft.discount);

  if (draft.unitCost.trim() === "") errors.unitCost = "Product cost is required.";
  if (toDecimal(draft.taxRate).greaterThan(100)) errors.taxRate = "Order tax can't be more than 100%.";
  if (draft.discountType === "PERCENTAGE" && discount.greaterThan(100)) {
    errors.discount = "A percentage discount can't be more than 100%.";
  } else if (draft.discountType === "FIXED" && discount.greaterThan(cost)) {
    errors.discount = "Discount can't be more than the product cost.";
  }
  return errors;
}

// Zero amounts open as empty fields so the "0.00" placeholder shows.
const blankIfZero = (value: string) => (toDecimal(value).isZero() ? "" : value);

// Per-line edit dialog (the pencil on an order row). Edits a draft copy and
// only hands it back on Save; the row's amounts are then recomputed by
// lib/pricing.ts like every other line change.
export default function PurchaseLineModal({
  line,
  onClose,
  onSave,
}: {
  line: PurchaseLine;
  onClose: () => void;
  onSave: (edit: PurchaseLineEdit) => void;
}) {
  const [draft, setDraft] = useState<PurchaseLineEdit>({
    unitCost: line.unitCost,
    taxType: line.taxType,
    taxRate: blankIfZero(line.taxRate),
    discountType: line.discountType,
    discount: blankIfZero(line.discount),
    purchaseUnit: line.purchaseUnit,
  });
  const [errors, setErrors] = useState<Errors>({});

  function set<K extends keyof PurchaseLineEdit>(key: K, value: PurchaseLineEdit[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The page form must not see this submit (the modal renders outside it,
    // but stop it anyway in case that ever changes).
    event.stopPropagation();
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave(draft);
  }

  return (
    <MasterDataModal title={line.name} onClose={onClose} onSubmit={handleSubmit} width={420}>
      <Field label="Product cost" required error={errors.unitCost}>
        <DecimalInput
          value={draft.unitCost}
          onChange={(value) => set("unitCost", value)}
          suffix="₦"
          hasError={!!errors.unitCost}
          autoFocus
          ariaLabel="Product cost"
        />
      </Field>
      <Field label="Tax type" required>
        <SelectInput
          value={draft.taxType}
          onChange={(value) => set("taxType", value as LineTaxType)}
          options={TAX_TYPE_OPTIONS}
        />
      </Field>
      <Field label="Order tax" error={errors.taxRate}>
        <DecimalInput
          value={draft.taxRate}
          onChange={(value) => set("taxRate", value)}
          suffix="%"
          hasError={!!errors.taxRate}
          ariaLabel="Order tax"
        />
      </Field>
      <Field label="Discount type" required>
        <SelectInput
          value={draft.discountType}
          onChange={(value) => set("discountType", value as LineDiscountType)}
          options={DISCOUNT_TYPE_OPTIONS}
        />
      </Field>
      <Field label="Discount" required error={errors.discount}>
        <DecimalInput
          value={draft.discount}
          onChange={(value) => set("discount", value)}
          hasError={!!errors.discount}
          ariaLabel="Discount"
        />
      </Field>
      <Field label="Purchase unit" required>
        <SelectInput
          value={draft.purchaseUnit}
          onChange={(value) => set("purchaseUnit", value)}
          options={PURCHASE_UNITS.map((unit) => ({ value: unit, label: unit }))}
        />
      </Field>
    </MasterDataModal>
  );
}
