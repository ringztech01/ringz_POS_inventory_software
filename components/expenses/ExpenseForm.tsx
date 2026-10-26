"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PrimaryButton from "@/components/ui/PrimaryButton";
import { DateInput, DecimalInput, Field, SelectInput, todayInputValue } from "@/components/purchases/form-fields";
import type { FormOption } from "@/app/(dashboard)/purchases/types";
import type { ExpenseActionState, ExpenseFieldName, ExpenseFormValues } from "@/app/(dashboard)/expenses/types";

const LIST_HREF = "/expenses";

function TextInput({
  value,
  onChange,
  placeholder,
  hasError,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hasError?: boolean;
  ariaLabel: string;
}) {
  const focus = useToggleState();

  return (
    <input
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={191}
      onChange={(event) => onChange(event.target.value)}
      onFocus={focus.on}
      onBlur={focus.off}
      style={{
        height: 40,
        border: `1px solid ${hasError ? COLORS.danger : focus.value ? COLORS.teal : COLORS.borderStrong}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        outline: "none",
        boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
      }}
    />
  );
}

// The design's disabled-looking read-only field (as the Sale reference on a
// sale return): the expense's reference, shown on edit, never editable.
function ReadOnlyMono({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  return (
    <input
      value={value}
      readOnly
      aria-label={ariaLabel}
      style={{
        height: 40,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 14,
        fontFamily: FONTS.mono,
        background: COLORS.bgApp,
        color: COLORS.slate,
        outline: "none",
      }}
    />
  );
}

// Create / edit form for an expense — RingzPOS Expenses design's create view.
// A single money-out record: no line items, no stock. Only the user's inputs
// (ids + strings) go to the server, which re-reads the warehouse and category
// and validates everything again. Edit starts from `initial` and shows the
// reference read-only (it's never regenerated).
export default function ExpenseForm({
  warehouses,
  categories,
  mode = "create",
  initial,
  reference,
  saveAction,
}: {
  warehouses: FormOption[];
  // Active expense categories.
  categories: FormOption[];
  mode?: "create" | "edit";
  initial?: ExpenseFormValues;
  // Edit only.
  reference?: string;
  // Server action (bound to the id on edit); Save is disabled until a module
  // provides one (Step 5).
  saveAction?: (values: ExpenseFormValues) => Promise<ExpenseActionState>;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [values, setValues] = useState<ExpenseFormValues>(
    initial ?? {
      date: todayInputValue(),
      title: "",
      warehouseId: "",
      expenseCategoryId: "",
      amount: "",
      details: "",
    },
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ExpenseFieldName, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const detailsFocus = useToggleState();

  const set = (field: ExpenseFieldName) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const errorOf = (field: ExpenseFieldName) => fieldErrors[field]?.[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !saveAction) return;
    setFieldErrors({});

    startTransition(async () => {
      const result = await saveAction(values);
      if (result.ok) {
        const verb = isEdit ? "updated" : "saved";
        toast.success(result.reference ? `Expense ${result.reference} ${verb}.` : `Expense ${verb}.`);
        router.push(LIST_HREF);
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>
            {isEdit ? "Edit Expense" : "Create Expense"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: COLORS.danger }}>*</span> are required.
          </p>
        </div>
        <GhostButton href={LIST_HREF} paddingX={18}>
          <ArrowLeft size={14} strokeWidth={1.7} />
          Back
        </GhostButton>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "22px 32px" }}>
          {/* Not in the design (it has no edit view): the reference, read-only. */}
          {isEdit && reference && (
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Reference">
                <ReadOnlyMono value={reference} ariaLabel="Reference" />
              </Field>
            </div>
          )}
          <Field label="Date" required error={errorOf("date")}>
            <DateInput value={values.date} onChange={set("date")} hasError={!!errorOf("date")} />
          </Field>
          <Field label="Expense Title" required error={errorOf("title")}>
            <TextInput
              value={values.title}
              onChange={set("title")}
              placeholder="Enter Expense Title"
              ariaLabel="Expense Title"
              hasError={!!errorOf("title")}
            />
          </Field>
          <Field label="Warehouse" required error={errorOf("warehouseId")}>
            <SelectInput
              value={values.warehouseId}
              onChange={set("warehouseId")}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              placeholder="Choose Warehouse"
              hasError={!!errorOf("warehouseId")}
            />
          </Field>
          <Field label="Expense Category" required error={errorOf("expenseCategoryId")}>
            <SelectInput
              value={values.expenseCategoryId}
              onChange={set("expenseCategoryId")}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose Expense Category"
              hasError={!!errorOf("expenseCategoryId")}
            />
          </Field>
          <Field label="Amount" required error={errorOf("amount")}>
            <DecimalInput
              value={values.amount}
              onChange={set("amount")}
              suffix="₦"
              placeholder="Enter Amount"
              ariaLabel="Amount"
              hasError={!!errorOf("amount")}
            />
          </Field>
          {/* Spans both columns (the design draws it in the second column). */}
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Details" error={errorOf("details")}>
              <textarea
                value={values.details}
                placeholder="Enter Details"
                aria-label="Details"
                maxLength={2000}
                onChange={(event) => set("details")(event.target.value)}
                onFocus={detailsFocus.on}
                onBlur={detailsFocus.off}
                style={{
                  minHeight: 96,
                  border: `1px solid ${errorOf("details") ? COLORS.danger : detailsFocus.value ? COLORS.teal : COLORS.borderStrong}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: FONTS.body,
                  outline: "none",
                  resize: "vertical",
                  boxShadow: detailsFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
                }}
              />
            </Field>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            paddingTop: 24,
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          <GhostButton href={LIST_HREF} paddingX={20}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={isPending || !saveAction} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save expense"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
