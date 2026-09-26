"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { Warehouse } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import GhostButton from "@/components/ui/GhostButton";
import type { WarehouseActionState } from "@/app/(dashboard)/warehouse/types";

type WarehouseFormValues = {
  name: string;
  email: string;
  phoneNumber: string;
  country: string;
  city: string;
  zipCode: string;
};

const EMPTY_VALUES: WarehouseFormValues = {
  name: "",
  email: "",
  phoneNumber: "",
  country: "",
  city: "",
  zipCode: "",
};

function Field({
  label,
  name,
  type = "text",
  mono,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  mono?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const focus = useToggleState();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} <span style={{ color: "#b3261e" }}>*</span>
      </label>
      <input
        type={type}
        name={name}
        required
        placeholder={`Enter ${label}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          height: 44,
          border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 12px",
          fontSize: 14,
          outline: "none",
          fontFamily: mono ? FONTS.mono : undefined,
          boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          transition: "border-color .12s, box-shadow .12s",
        }}
      />
    </div>
  );
}

export default function WarehouseForm({
  warehouse,
  action,
}: {
  warehouse?: Warehouse;
  action: (formData: FormData) => Promise<WarehouseActionState>;
}) {
  const router = useRouter();
  const isEdit = !!warehouse;
  const [values, setValues] = useState<WarehouseFormValues>(
    warehouse
      ? {
          name: warehouse.name,
          email: warehouse.email,
          phoneNumber: warehouse.phoneNumber,
          country: warehouse.country,
          city: warehouse.city,
          zipCode: warehouse.zipCode,
        }
      : EMPTY_VALUES,
  );
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof WarehouseFormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await action(formData);

      if (result.status === "success") {
        toast.success(result.message);
        router.push("/warehouse");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-.015em",
            }}
          >
            {isEdit ? "Edit Warehouse" : "Create Warehouse"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: "#b3261e" }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/warehouse" paddingX={18}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "24px 32px" }}>
          <Field label="Name" name="name" value={values.name} onChange={(v) => updateField("name", v)} />
          <Field
            label="Email"
            name="email"
            type="email"
            value={values.email}
            onChange={(v) => updateField("email", v)}
          />
          <Field
            label="Phone Number"
            name="phoneNumber"
            mono
            value={values.phoneNumber}
            onChange={(v) => updateField("phoneNumber", v)}
          />
          <Field label="Country" name="country" value={values.country} onChange={(v) => updateField("country", v)} />
          <Field label="City" name="city" value={values.city} onChange={(v) => updateField("city", v)} />
          <Field
            label="Zip Code"
            name="zipCode"
            mono
            value={values.zipCode}
            onChange={(v) => updateField("zipCode", v)}
          />
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
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save"}
          </PrimaryButton>
          <GhostButton href="/warehouse">Cancel</GhostButton>
        </div>
      </form>
    </div>
  );
}
