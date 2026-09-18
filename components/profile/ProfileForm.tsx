"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import type { Role } from "@prisma/client";
import { Pencil, User as UserIcon, ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { updateProfile } from "@/app/(dashboard)/profile/actions";
import { initialProfileActionState, type ProfileActionState } from "@/app/(dashboard)/profile/types";

type ProfileUser = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  image: string | null;
  role: Role;
};

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};

function inputStyle(focused: boolean): CSSProperties {
  return {
    height: 40,
    border: `1px solid ${focused ? COLORS.teal : COLORS.borderStrong}`,
    borderRadius: 8,
    padding: "0 12px",
    fontSize: 14,
    outline: "none",
    boxShadow: focused ? `0 0 0 3px ${COLORS.focusRing}` : "none",
    transition: "border-color .12s, box-shadow .12s",
  };
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
        {label} {required && <span style={{ color: "#b3261e" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ProfileForm({ user }: { user: ProfileUser }) {
  const { update: updateSession } = useSession();
  const [state, setState] = useState<ProfileActionState>(initialProfileActionState);
  const [isPending, startTransition] = useTransition();

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [email, setEmail] = useState(user.email);
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? "");
  const [currentImage, setCurrentImage] = useState(user.image);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstNameFocus = useToggleState();
  const lastNameFocus = useToggleState();
  const emailFocus = useToggleState();
  const phoneFocus = useToggleState();
  const avatarHover = useToggleState();
  const saveHover = useToggleState();

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateProfile(formData);
      setState(result);

      if (result.status === "success" && result.user) {
        setFirstName(result.user.firstName);
        setLastName(result.user.lastName);
        setEmail(result.user.email);
        setPhoneNumber(result.user.phoneNumber ?? "");
        setCurrentImage(result.user.image);
        setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = "";

        // Refresh the client session so the topbar's name/avatar (which reads
        // from useSession()) picks up the change immediately, without a re-login.
        await updateSession({
          name: `${result.user.firstName} ${result.user.lastName}`,
          email: result.user.email,
          image: result.user.image,
        });
      }
    });
  }

  const avatarSrc = previewUrl ?? currentImage;

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
          Profile
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
        }}
      >
        {state.status !== "idle" && (
          <div
            style={{
              background: state.status === "success" ? "#eff8f6" : "#fceceb",
              border: `1px solid ${state.status === "success" ? COLORS.tealBorder : "#f3c7c2"}`,
              color: state.status === "success" ? COLORS.tealDark : "#e0483d",
              borderRadius: 9,
              padding: "12px 15px",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {state.message}
          </div>
        )}

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
          <Field label="First Name" required>
            <input
              name="firstName"
              required
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              onFocus={firstNameFocus.on}
              onBlur={firstNameFocus.off}
              style={inputStyle(firstNameFocus.value)}
            />
          </Field>

          <Field label="Last Name" required>
            <input
              name="lastName"
              required
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              onFocus={lastNameFocus.on}
              onBlur={lastNameFocus.off}
              style={inputStyle(lastNameFocus.value)}
            />
          </Field>

          <Field label="Email" required>
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onFocus={emailFocus.on}
              onBlur={emailFocus.off}
              style={inputStyle(emailFocus.value)}
            />
          </Field>

          <Field label="Phone Number">
            <input
              name="phoneNumber"
              placeholder="Enter Phone Number"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              onFocus={phoneFocus.on}
              onBlur={phoneFocus.off}
              style={{ ...inputStyle(phoneFocus.value), fontFamily: FONTS.mono }}
            />
          </Field>

          {/*
            Role is read-only on purpose. This is a self-service profile page, not
            the admin Users page — letting a user edit their own role here would
            let anyone promote themselves to admin. Since the field is `disabled`,
            the browser also never includes it in the submitted FormData, and the
            server action (app/(dashboard)/profile/actions.ts) never reads a role
            value at all. Role changes must go through a separate admin-only flow.
          */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Role</label>
            <div style={{ position: "relative" }}>
              <select
                disabled
                value={user.role}
                onChange={() => {}}
                style={{
                  appearance: "none",
                  width: "100%",
                  height: 40,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 8,
                  padding: "0 36px 0 12px",
                  fontSize: 14,
                  background: COLORS.bgApp,
                  color: COLORS.slateMid,
                  cursor: "not-allowed",
                }}
              >
                <option value={user.role}>{ROLE_LABELS[user.role]}</option>
              </select>
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                color={COLORS.slateMid}
                style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none" }}
              />
            </div>
            <p style={{ margin: 0, fontSize: 12, color: COLORS.slateLight }}>
              Role changes are managed by an administrator.
            </p>
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
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
