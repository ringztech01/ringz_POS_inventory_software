"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { Role } from "@prisma/client";
import { ArrowLeft, Eye, EyeOff, Pencil, User as UserIcon, ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { ROLE_OPTIONS } from "@/lib/roles";
import PrimaryButton from "@/components/ui/PrimaryButton";
import GhostButton from "@/components/ui/GhostButton";
import type { PublicUser } from "@/app/(dashboard)/peoples/users/queries";
import type { UserActionState } from "@/app/(dashboard)/peoples/users/types";

type UserFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
  role: Role;
};

const EMPTY_VALUES: UserFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
  role: "CASHIER",
};

function Field({
  label,
  name,
  type = "text",
  mono,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  mono?: boolean;
  autoComplete?: string;
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
        autoComplete={autoComplete}
        placeholder={`Enter ${label}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        style={{
          height: 40,
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

function PasswordField({
  label,
  name,
  required,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const focus = useToggleState();
  const visible = useToggleState();
  const toggleHover = useToggleState();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} {required && <span style={{ color: "#b3261e" }}>*</span>}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={visible.value ? "text" : "password"}
          name={name}
          required={required}
          autoComplete={autoComplete}
          placeholder={`Enter ${label}`}
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
            outline: "none",
            boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            transition: "border-color .12s, box-shadow .12s",
          }}
        />
        <button
          type="button"
          title={visible.value ? "Hide password" : "Show password"}
          onClick={visible.value ? visible.off : visible.on}
          onMouseEnter={toggleHover.on}
          onMouseLeave={toggleHover.off}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            height: 40,
            width: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: toggleHover.value ? COLORS.ink : COLORS.slateMid,
          }}
        >
          {visible.value ? <EyeOff size={16} strokeWidth={1.6} /> : <Eye size={16} strokeWidth={1.6} />}
        </button>
      </div>
    </div>
  );
}

function RoleField({ value, onChange }: { value: Role; onChange: (value: Role) => void }) {
  const focus = useToggleState();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        Role <span style={{ color: "#b3261e" }}>*</span>
      </label>
      <div style={{ position: "relative" }}>
        <select
          name="role"
          required
          value={value}
          onChange={(event) => onChange(event.target.value as Role)}
          onFocus={focus.on}
          onBlur={focus.off}
          style={{
            appearance: "none",
            width: "100%",
            height: 40,
            border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 36px 0 12px",
            fontSize: 14,
            background: "#fff",
            cursor: "pointer",
            outline: "none",
            boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          }}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          color={COLORS.slateMid}
          style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

export default function UserForm({
  user,
  action,
}: {
  user?: PublicUser;
  action: (formData: FormData) => Promise<UserActionState>;
}) {
  const router = useRouter();
  const isEdit = !!user;
  const [values, setValues] = useState<UserFormValues>(
    user
      ? {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber ?? "",
          password: "",
          confirmPassword: "",
          role: user.role,
        }
      : EMPTY_VALUES,
  );
  const [isPending, startTransition] = useTransition();
  const avatarHover = useToggleState();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateField<K extends keyof UserFormValues>(name: K, value: UserFormValues[K]) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  }

  const avatarSrc = previewUrl ?? user?.image ?? null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await action(formData);

      if (result.status === "success") {
        toast.success(result.message);
        router.push("/peoples/users");
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
            {isEdit ? "Edit User" : "Create User"}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            Fields marked <span style={{ color: "#b3261e" }}>*</span> are required.
          </p>
        </div>
        <GhostButton href="/peoples/users" paddingX={18}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Change Image</label>
          <div style={{ position: "relative", width: 96, height: 96 }}>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: 999,
                background: "#dfe9ea",
                border: "1px solid #cdd9da",
                display: "flex",
                alignItems: avatarSrc ? "stretch" : "end",
                justifyContent: "center",
                overflow: "hidden",
                color: "#8aa0a2",
              }}
            >
              {avatarSrc ? (
                // Local blob: previews and uploaded /uploads paths both render fine as
                // a plain <img>; next/image doesn't handle blob: preview URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <UserIcon size={60} strokeWidth={1} fill="currentColor" />
              )}
            </div>
            <button
              type="button"
              title="Change image"
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={avatarHover.on}
              onMouseLeave={avatarHover.off}
              style={{
                position: "absolute",
                right: -2,
                top: -2,
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "#fff",
                border: `1px solid ${avatarHover.value ? COLORS.tealBorder : COLORS.borderStrong}`,
                boxShadow: "0 1px 3px rgba(23,27,28,.14)",
                cursor: "pointer",
                color: avatarHover.value ? COLORS.teal : COLORS.slate,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Pencil size={13} strokeWidth={1.8} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              name="image"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "22px 32px" }}>
          <Field
            label="First Name"
            name="firstName"
            value={values.firstName}
            onChange={(v) => updateField("firstName", v)}
          />
          <Field
            label="Last Name"
            name="lastName"
            value={values.lastName}
            onChange={(v) => updateField("lastName", v)}
          />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="off"
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
          <PasswordField
            label="Password"
            name="password"
            required={!isEdit}
            autoComplete="new-password"
            value={values.password}
            onChange={(v) => updateField("password", v)}
          />
          <PasswordField
            label="Confirm Password"
            name="confirmPassword"
            required={!isEdit}
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={(v) => updateField("confirmPassword", v)}
          />
          <RoleField value={values.role} onChange={(v) => updateField("role", v)} />
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
          <GhostButton href="/peoples/users" paddingX={20}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={isPending} paddingX={24} fontSize={14}>
            {isPending ? "Saving…" : "Save user"}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
