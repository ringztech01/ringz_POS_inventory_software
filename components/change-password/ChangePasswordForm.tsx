"use client";

import { useState, useTransition, type CSSProperties, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { changePassword } from "@/app/(dashboard)/change-password/actions";

function PasswordField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const focus = useToggleState();
  const visible = useToggleState();
  const toggleHover = useToggleState();

  const inputStyle: CSSProperties = {
    width: "100%",
    height: 40,
    border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
    borderRadius: 8,
    padding: "0 40px 0 12px",
    fontSize: 14,
    color: COLORS.ink,
    outline: "none",
    boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
    transition: "border-color .12s, box-shadow .12s",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} <span style={{ color: "#b3261e" }}>*</span>
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={visible.value ? "text" : "password"}
          name={name}
          required
          autoComplete={name === "currentPassword" ? "current-password" : "new-password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={focus.on}
          onBlur={focus.off}
          style={inputStyle}
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

const EMPTY_FIELDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

export default function ChangePasswordForm() {
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [isPending, startTransition] = useTransition();
  const saveHover = useToggleState();
  const cancelHover = useToggleState();

  function updateField(name: keyof typeof fields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function handleCancel() {
    setFields(EMPTY_FIELDS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await changePassword(formData);

      if (result.status === "success") {
        toast.success(result.message);
        setFields(EMPTY_FIELDS);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
          Change Password
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
          Fields marked <span style={{ color: "#b3261e" }}>*</span> are required.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 480,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <PasswordField
            name="currentPassword"
            label="Current Password"
            value={fields.currentPassword}
            onChange={(value) => updateField("currentPassword", value)}
          />
          <PasswordField
            name="newPassword"
            label="New Password"
            value={fields.newPassword}
            onChange={(value) => updateField("newPassword", value)}
          />
          <PasswordField
            name="confirmPassword"
            label="Confirm New Password"
            value={fields.confirmPassword}
            onChange={(value) => updateField("confirmPassword", value)}
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
          <button
            type="button"
            onClick={handleCancel}
            onMouseEnter={cancelHover.on}
            onMouseLeave={cancelHover.off}
            style={{
              height: 40,
              padding: "0 20px",
              background: cancelHover.value ? COLORS.bgApp : "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              color: COLORS.text,
              cursor: "pointer",
              transition: "background .12s",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            onMouseEnter={saveHover.on}
            onMouseLeave={saveHover.off}
            style={{
              height: 40,
              padding: "0 24px",
              background: saveHover.value && !isPending ? COLORS.tealDark : COLORS.teal,
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              cursor: isPending ? "default" : "pointer",
              opacity: isPending ? 0.75 : 1,
              transition: "background .12s",
            }}
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
