"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { Field } from "@/components/purchases/form-fields";
import { COLORS } from "@/components/layout/theme";
import { DEPARTMENT_LABEL, DEPARTMENT_SHADES, DEPARTMENTS, type Department } from "../../lib/posGrid";
import type { MenuGroupRow } from "../../lib/posMenu";
import { MENU_GROUP_NAME_MAX, type MenuGroupField } from "../../schemas/menuGroup";
import { createMenuGroup, deleteMenuGroup, updateMenuGroup } from "../../server/actions/menuGroups";
import TextInput from "../TextInput";

// Colours to pick from: both departments' shades and a few more (white text
// reads on every one).
const SWATCHES = [...DEPARTMENT_SHADES.FOOD, ...DEPARTMENT_SHADES.BAR, "#0F7D6A", "#2E7D32", "#6A1B9A", "#AD1457", "#455A64", "#5D4037"];

export type GroupModalState = { mode: "add"; parentId: string | null; department: Department } | { mode: "edit"; group: MenuGroupRow };

// Add / edit a POS button group: name, colour (or automatic), where it sits
// (top level or inside another group of the same side) and, for a top group,
// Food or Bar. Delete from here too (refused while it has sub-groups).
export default function MenuGroupModal({ state, groups, onClose }: { state: GroupModalState; groups: MenuGroupRow[]; onClose: () => void }) {
  const editing = state.mode === "edit" ? state.group : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [colour, setColour] = useState<string | null>(editing?.colour ?? null);
  const [parentId, setParentId] = useState<string | null>(editing ? editing.parentId : state.mode === "add" ? state.parentId : null);
  const [department, setDepartment] = useState<Department>(editing?.department ?? (state.mode === "add" ? state.department : "FOOD"));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MenuGroupField, string[]>>>({});
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Not itself or anything inside it; same side as the group.
  const inside = new Set<string>(editing ? [editing.id] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) {
      if (g.parentId && inside.has(g.parentId) && !inside.has(g.id)) {
        inside.add(g.id);
        grew = true;
      }
    }
  }
  const parents = groups.filter((g) => !inside.has(g.id) && g.department === department);
  const pathName = (g: MenuGroupRow): string => {
    const parent = g.parentId ? groups.find((p) => p.id === g.parentId) : undefined;
    return parent ? `${pathName(parent)} › ${g.name}` : g.name;
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { name, department, parentId, colour };
      const result = editing ? await updateMenuGroup(editing.id, input) : await createMenuGroup(input);
      if (result.ok) {
        toast.success(editing ? `${name.trim()} saved.` : `${name.trim()} added.`);
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  function remove() {
    if (!editing) return;
    startTransition(async () => {
      const result = await deleteMenuGroup(editing.id);
      if (result.ok) {
        toast.success(result.dishes ? `${editing.name} deleted. Its ${result.dishes} ${result.dishes === 1 ? "dish is" : "dishes are"} back in Not placed.` : `${editing.name} deleted.`);
        onClose();
      } else {
        setConfirming(false);
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <MasterDataModal title={editing ? "Edit group" : "Add group"} onClose={onClose} onSubmit={handleSubmit} submitting={isPending} submitLabel={editing ? "Save" : "Add group"} width={480}>
        <Field label="Name" required error={fieldErrors.name?.[0]}>
          <TextInput value={name} onChange={setName} placeholder="e.g. Rice" maxLength={MENU_GROUP_NAME_MAX} hasError={!!fieldErrors.name} ariaLabel="Name" autoFocus />
        </Field>
        <Field label="Inside" error={fieldErrors.parentId?.[0]}>
          <select
            aria-label="Inside"
            value={parentId ?? ""}
            onChange={(event) => setParentId(event.target.value || null)}
            style={{ height: 40, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff" }}
          >
            <option value="">Top level ({DEPARTMENT_LABEL[department]})</option>
            {parents.map((g) => (
              <option key={g.id} value={g.id}>
                {pathName(g)}
              </option>
            ))}
          </select>
        </Field>
        {!parentId && (
          <Field label="Side" required error={fieldErrors.department?.[0]}>
            <div role="radiogroup" aria-label="Side" style={{ display: "flex", gap: 8 }}>
              {DEPARTMENTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={department === d}
                  onClick={() => setDepartment(d)}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 8,
                    border: `1px solid ${department === d ? DEPARTMENT_SHADES[d][0] : COLORS.borderStrong}`,
                    background: department === d ? DEPARTMENT_SHADES[d][0] : "#fff",
                    color: department === d ? "#fff" : COLORS.slate,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {DEPARTMENT_LABEL[d]}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Colour" error={fieldErrors.colour?.[0]}>
          <div role="radiogroup" aria-label="Colour" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button
              type="button"
              role="radio"
              aria-checked={colour === null}
              onClick={() => setColour(null)}
              style={{ height: 32, padding: "0 10px", borderRadius: 6, border: `2px solid ${colour === null ? COLORS.ink : COLORS.borderStrong}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              Automatic
            </button>
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={colour === swatch}
                aria-label={`Colour ${swatch}`}
                onClick={() => setColour(swatch)}
                style={{ width: 32, height: 32, borderRadius: 6, background: swatch, border: `2px solid ${colour === swatch ? COLORS.ink : "transparent"}`, outline: colour === swatch ? "2px solid #fff" : "none", outlineOffset: -4, cursor: "pointer" }}
              />
            ))}
          </div>
          <span style={{ fontSize: 12, color: COLORS.slateMid }}>Automatic: a sub-group takes its parent&apos;s colour; a top group its side&apos;s next shade.</span>
        </Field>
        {editing && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            style={{ alignSelf: "flex-start", border: "none", background: "none", padding: 0, color: COLORS.danger, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Delete group
          </button>
        )}
      </MasterDataModal>
      {confirming && editing && (
        <ConfirmDeleteModal
          title="Delete group"
          message={`Delete "${editing.name}"? Its dishes go back to Not placed (on the POS they show under their category until you place them again).`}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
          pending={isPending}
        />
      )}
    </>
  );
}
