"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { Customer } from "@prisma/client";
import { ArrowLeft, Calendar } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import GhostButton from "@/components/ui/GhostButton";
import { formatDateForInput } from "@/lib/format";
import type { CustomerActionState } from "@/app/(dashboard)/peoples/customers/types";

type CustomerFormValues = {
  name: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;
  country: string;
  city: string;
  address: string;
};

const EMPTY_VALUES: CustomerFormValues = {
  name: "",
  email: "",
  phoneNumber: "",
  dateOfBirth: "",
  country: "",
  city: "",
  address: "",
};

function Field({
  label,
  name,
  type = "text",
  mono,
  required = true,
  readOnly,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  mono?: boolean;
  required?: boolean;
  readOnly?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const focus = useToggleState();
  const showFocusRing = focus.value && !readOnly;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} {required && <span style={{ color: "#b3261e" }}>*</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        readOnly={readOnly}
        title={readOnly ? "This name can't be changed" : undefined}
        placeholder={`Enter ${label}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          height: 40,
          border: `1px solid ${showFocusRing ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 12px",
          fontSize: 14,
          outline: "none",
          fontFamily: mono ? FONTS.mono : undefined,
          background: readOnly ? COLORS.bgApp : undefined,
          color: readOnly ? COLORS.slateMid : undefined,
          cursor: readOnly ? "not-allowed" : undefined,
          boxShadow: showFocusRing ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          transition: "border-color .12s, box-shadow .12s",
        }}
      />
    </div>
  );
}

function DateField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const focus = useToggleState();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type="date"
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={focus.on}
          onBlur={focus.off}
          style={{
            width: "100%",
            height: 40,
            border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 40px 0 12px",
            fontSize: 14,
            fontFamily: FONTS.mono,
            outline: "none",
            boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            transition: "border-color .12s, box-shadow .12s",
          }}
        />
        <Calendar
          size={15}
          strokeWidth={1.5}
          color={COLORS.slateMid}
          style={{ position: "absolute", right: 12, top: 12, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

export default function CustomerForm({
  customer,
  action,
}: {
  customer?: Customer;
  action: (formData: FormData) => Promise<CustomerActionState>;
}) {
  const router = useRouter();
  const isEdit = !!customer;
  const [values, setValues] = useState<CustomerFormValues>(
    customer
      ? {
          name: customer.name,
          email: customer.email,
          phoneNumber: customer.phoneNumber,
          dateOfBirth: formatDateForInput(customer.dateOfBirth),
          country: customer.country,
          city: customer.city,
          address: customer.address,
        }
      : EMPTY_VALUES,
  );
  const [isPending, startTransition] = useTransition();
  const addressFocus = useToggleState();

  function updateField(name: keyof CustomerFormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await action(formData);

      if (result.status === "success") {
        toast.success(result.message);
        router.push("/peoples/customers");
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
            {isEdit ? "Edit Customer" : "Create Customer"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: "#b3261e" }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/peoples/customers" paddingX={18}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "22px 32px" }}>
          {/*
            direct-customer's name is read-only in the UI (kept in FormData
            via readOnly, not disabled, so the rest of the form can still
            submit) as a first line of defense. The real enforcement is
            server-side in updateCustomer, which ignores this field entirely
            for that record — see app/(dashboard)/peoples/customers/actions.ts.
          */}
          <Field
            label="Name"
            name="name"
            readOnly={customer?.isDefault}
            value={values.name}
            onChange={(v) => updateField("name", v)}
          />
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
          <DateField
            label="DOB"
            name="dateOfBirth"
            value={values.dateOfBirth}
            onChange={(v) => updateField("dateOfBirth", v)}
          />
          <Field label="Country" name="country" value={values.country} onChange={(v) => updateField("country", v)} />
          <Field label="City" name="city" value={values.city} onChange={(v) => updateField("city", v)} />
        </div>

        {customer?.isDefault && (
          <p style={{ margin: "-12px 0 0", fontSize: 12, color: COLORS.slateLight }}>
            This is the default walk-in customer used by the POS — its name can&apos;t be changed.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "calc(50% - 16px)" }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
            Address <span style={{ color: "#b3261e" }}>*</span>
          </label>
          <textarea
            name="address"
            required
            placeholder="Enter Address"
            value={values.address}
            onChange={(event) => updateField("address", event.target.value)}
            onFocus={addressFocus.on}
            onBlur={addressFocus.off}
            style={{
              minHeight: 110,
              border: `1px solid ${addressFocus.value ? COLORS.teal : COLORS.borderStrong}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
              resize: "vertical",
              boxShadow: addressFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
              transition: "border-color .12s, box-shadow .12s",
            }}
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
          <GhostButton href="/peoples/customers" paddingX={20}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save customer"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
