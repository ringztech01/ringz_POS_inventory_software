"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import GhostButton from "@/components/ui/GhostButton";
import PrimaryButton from "@/components/ui/PrimaryButton";
import { ALL_PERMISSIONS, type Permission, type PermissionGroup } from "@/lib/permissions";
import type { RoleActionState, RoleFieldName, RoleFormValues } from "@/app/(dashboard)/roles/types";

const LIST_HREF = "/roles";

const checkbox = { width: 18, height: 18, flex: "0 0 auto", accentColor: COLORS.teal, cursor: "pointer", margin: 0 } as const;

// Create / edit a role — RingzPOS Roles design's create view. The checkbox
// grid is rendered from PERMISSIONS (lib/permissions.ts), never hardcoded.
// "All Permissions" is a UI toggle only: it checks/unchecks everything shown
// and shows checked when all of those are selected; it is never sent or
// stored.
export default function RoleForm({
  mode = "create",
  initial,
  locked = false,
  groups,
  saveAction,
}: {
  mode?: "create" | "edit";
  initial?: RoleFormValues;
  // The checkbox blocks (permissionGroups): the core set, plus each optional
  // module that's switched on. A hidden module's permissions the role already
  // has are still sent, so saving while it's off doesn't drop them.
  groups: PermissionGroup[];
  // The isSystem admin role: every permission, always — the checkboxes show
  // checked and can't be changed (the server ignores them anyway).
  locked?: boolean;
  // Server action (bound to the id on edit).
  saveAction: (values: RoleFormValues) => Promise<RoleActionState>;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [name, setName] = useState(initial?.name ?? "");
  const [checked, setChecked] = useState<Set<Permission>>(
    () => new Set(locked ? ALL_PERMISSIONS : (initial?.permissions ?? [])),
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RoleFieldName, string[]>>>({});
  const [isPending, startTransition] = useTransition();
  const nameFocus = useToggleState();

  const shown = groups.flatMap((group) => group.permissions);
  const allChecked = shown.every((permission) => checked.has(permission));

  function toggle(permission: Permission) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function toggleAll() {
    setChecked((current) => {
      const next = new Set(current);
      for (const permission of shown) {
        if (allChecked) next.delete(permission);
        else next.add(permission);
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});

    // Sent in PERMISSIONS order; the server validates and deduplicates.
    const permissions = ALL_PERMISSIONS.filter((permission) => checked.has(permission));

    startTransition(async () => {
      const result = await saveAction({ name, permissions });
      if (result.ok) {
        toast.success(isEdit ? `Role "${name.trim()}" updated.` : `Role "${name.trim()}" created.`);
        router.push(LIST_HREF);
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  const nameError = fieldErrors.name?.[0];
  const permissionsError = fieldErrors.permissions?.[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: "-.015em" }}>
            {isEdit ? "Edit Role" : "Create Role"}
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
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="role-name" style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
            Name <span style={{ color: COLORS.danger }}>*</span>
          </label>
          <input
            id="role-name"
            value={name}
            placeholder="Enter Name"
            maxLength={191}
            onChange={(event) => setName(event.target.value)}
            onFocus={nameFocus.on}
            onBlur={nameFocus.off}
            style={{
              height: 44,
              border: `1px solid ${nameError ? COLORS.danger : nameFocus.value ? COLORS.teal : COLORS.borderStrong}`,
              borderRadius: 8,
              padding: "0 12px",
              fontSize: 14,
              outline: "none",
              boxShadow: nameFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            }}
          />
          {nameError && <span style={{ fontSize: 12, color: COLORS.danger }}>{nameError}</span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* No asterisk (the design has one): a role may have no
                permissions, e.g. one that can only sign in. */}
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Permissions</span>
            <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={locked} style={checkbox} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.tealDark }}>All Permissions</span>
            </label>
          </div>

          {groups.map((group) => (
            <div key={group.label ?? ""} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {group.label && (
                <span
                  style={{
                    paddingTop: 16,
                    borderTop: `1px solid ${COLORS.border}`,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: COLORS.slateMid,
                  }}
                >
                  {group.label}
                </span>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "14px 32px" }}>
                {group.permissions.map((permission) => (
                  <label key={permission} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: "2px 0" }}>
                    <input
                      type="checkbox"
                      checked={checked.has(permission)}
                      onChange={() => toggle(permission)}
                      disabled={locked}
                      style={checkbox}
                    />
                    <span style={{ fontSize: 13.5, color: COLORS.text }}>{permission}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {locked && (
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
              The Administrator role always has every permission.
            </span>
          )}
          {permissionsError && <span style={{ fontSize: 12, color: COLORS.danger }}>{permissionsError}</span>}
        </div>

        <div style={{ display: "flex", gap: 12, paddingTop: 24, borderTop: `1px solid ${COLORS.border}` }}>
          <PrimaryButton type="submit" disabled={isPending} paddingX={26} fontSize={14}>
            {isPending ? "Saving…" : "Save"}
          </PrimaryButton>
          <GhostButton href={LIST_HREF} paddingX={24}>
            Cancel
          </GhostButton>
        </div>
      </form>
    </div>
  );
}
