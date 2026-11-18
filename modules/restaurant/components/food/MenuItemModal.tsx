"use client";

import { useState, useTransition, type FormEvent } from "react";
import toast from "react-hot-toast";
import MasterDataModal from "@/components/ui/MasterDataModal";
import { Field, SelectInput, type SelectOption } from "@/components/purchases/form-fields";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { COMMON_ALLERGENS, MENU_ALLERGEN_MAX, MENU_ALLERGENS_MAX, MENU_CODE_MAX, MENU_DESCRIPTION_MAX, MENU_NAME_MAX, type MenuItemField } from "../../schemas/menuItem";
import { createMenuItem, updateMenuItem } from "../../server/actions/menuItems";
import type { MenuItemRow } from "../../server/queries/menuItems";
import TextInput from "../TextInput";
import KitchenStationSelect from "./KitchenStationSelect";
import MenuMediaSection from "./MenuMediaSection";

// Add / edit a menu item in the shared modal shell. The server validates,
// checks the code is free and saves; food cost and margin come from the
// recipe (Recipes tab) and are shown read-only. The digital menu's details
// (allergens, calories, Signature) save with it; its media (Part 8 Step 5)
// is saved as each upload finishes.
export default function MenuItemModal({
  item,
  categories,
  stations,
  onClose,
  onDelete,
}: {
  item: MenuItemRow | null;
  categories: SelectOption[];
  stations: SelectOption[];
  onClose: () => void;
  onDelete: (item: MenuItemRow) => void;
}) {
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [stationId, setStationId] = useState(item?.stationId ?? "");
  const [allergens, setAllergens] = useState<string[]>(item?.allergens ?? []);
  const [otherAllergen, setOtherAllergen] = useState("");
  const [calories, setCalories] = useState(item?.calories === null || item?.calories === undefined ? "" : String(item.calories));
  const [isSignature, setIsSignature] = useState(item?.isSignature ?? false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MenuItemField, string[]>>>({});
  const [isPending, startTransition] = useTransition();

  // A station that's been switched off stays selectable on its own items.
  const stationOptions = item?.stationId && item.station && !stations.some((s) => s.value === item.stationId)
    ? [...stations, { value: item.stationId, label: `${item.station} (inactive)` }]
    : stations;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFieldErrors({});
    startTransition(async () => {
      const input = { code, name, categoryId, price, description, stationId, allergens, calories, isSignature };
      const result = item ? await updateMenuItem(item.id, input) : await createMenuItem(input);
      if (result.ok) {
        toast.success(item ? `${name.trim()} saved.` : `${name.trim()} added.`);
        onClose();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  const readOnly = { height: 40, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "0 12px", display: "flex", alignItems: "center", fontSize: 13.5, fontFamily: FONTS.mono, background: COLORS.bgInput, color: COLORS.slate } as const;

  return (
    <MasterDataModal
      title={item ? "Edit menu item" : "Add menu item"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={isPending}
      submitLabel={item ? "Save" : "Add menu item"}
      width={560}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <Field label="Code" required error={fieldErrors.code?.[0]}>
          <TextInput value={code} onChange={setCode} placeholder="e.g. MN-001" maxLength={MENU_CODE_MAX} hasError={!!fieldErrors.code} ariaLabel="Code" autoFocus={!item} />
        </Field>
        <Field label="Name" required error={fieldErrors.name?.[0]}>
          <TextInput value={name} onChange={setName} placeholder="e.g. Jollof Rice & Chicken" maxLength={MENU_NAME_MAX} hasError={!!fieldErrors.name} ariaLabel="Name" />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category" required error={fieldErrors.categoryId?.[0]}>
          <SelectInput value={categoryId} onChange={setCategoryId} options={categories} placeholder="Choose category" hasError={!!fieldErrors.categoryId} />
        </Field>
        <Field label="Price (₦)" required error={fieldErrors.price?.[0]}>
          <TextInput value={price} onChange={setPrice} placeholder="0.00" inputMode="numeric" maxLength={12} hasError={!!fieldErrors.price} ariaLabel="Price" />
        </Field>
      </div>
      <KitchenStationSelect value={stationId} onChange={setStationId} options={stationOptions} error={fieldErrors.stationId?.[0]} />
      <Field label="Description" error={fieldErrors.description?.[0]}>
        <textarea
          aria-label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={MENU_DESCRIPTION_MAX}
          rows={3}
          placeholder="Shown on the digital menu"
          style={{ border: `1px solid ${fieldErrors.description ? COLORS.danger : COLORS.borderStrong}`, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, resize: "vertical", outline: "none", fontFamily: "inherit" }}
        />
        <span style={{ alignSelf: "flex-end", fontSize: 11.5, color: COLORS.slateLight }}>
          {description.length}/{MENU_DESCRIPTION_MAX}
        </span>
      </Field>
      <Field label="Allergens" error={fieldErrors.allergens?.[0]}>
        <div data-allergens style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[...COMMON_ALLERGENS, ...allergens.filter((a) => !COMMON_ALLERGENS.some((c) => c.toLowerCase() === a.toLowerCase()))].map((name) => {
            const on = allergens.some((a) => a.toLowerCase() === name.toLowerCase());
            return (
              <button
                key={name}
                type="button"
                data-allergen={name}
                aria-pressed={on}
                onClick={() => setAllergens(on ? allergens.filter((a) => a.toLowerCase() !== name.toLowerCase()) : [...allergens, name])}
                style={{ height: 28, padding: "0 10px", borderRadius: 14, border: `1px solid ${on ? COLORS.teal : COLORS.borderStrong}`, background: on ? COLORS.tealTint : "#fff", color: on ? COLORS.tealDark : COLORS.slate, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <TextInput value={otherAllergen} onChange={setOtherAllergen} placeholder="Another allergen" maxLength={MENU_ALLERGEN_MAX} ariaLabel="Another allergen" />
          <button
            type="button"
            data-allergen-add
            disabled={!otherAllergen.trim() || allergens.length >= MENU_ALLERGENS_MAX}
            onClick={() => {
              const value = otherAllergen.trim();
              if (value && !allergens.some((a) => a.toLowerCase() === value.toLowerCase())) setAllergens([...allergens, value]);
              setOtherAllergen("");
            }}
            style={{ height: 40, padding: "0 14px", borderRadius: 8, border: `1px solid ${COLORS.borderStrong}`, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            Add
          </button>
        </div>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
        <Field label="Calories (kcal)" error={fieldErrors.calories?.[0]}>
          <TextInput value={calories} onChange={setCalories} placeholder="e.g. 640" inputMode="numeric" maxLength={4} hasError={!!fieldErrors.calories} ariaLabel="Calories" />
        </Field>
        <label data-signature style={{ display: "flex", alignItems: "center", gap: 8, height: 40, fontSize: 13.5, color: COLORS.text, cursor: "pointer" }}>
          <input type="checkbox" checked={isSignature} onChange={(e) => setIsSignature(e.target.checked)} style={{ width: 16, height: 16, accentColor: COLORS.teal }} />
          Signature dish (a pill on the menu)
        </label>
      </div>
      <MenuMediaSection productId={item?.id ?? null} name={name || item?.name || ""} />
      {item && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Food cost">
            <span data-food-cost style={readOnly}>{item.foodCost === null ? "No recipe" : formatNaira(item.foodCost)}</span>
          </Field>
          <Field label="Margin">
            <span data-margin style={readOnly}>{item.margin === null ? "—" : `${item.margin}%`}</span>
          </Field>
        </div>
      )}
      {item && (
        <button
          type="button"
          onClick={() => onDelete(item)}
          disabled={!!item.deleteBlocker}
          title={item.deleteBlocker ?? `Delete ${item.name}`}
          style={{ alignSelf: "flex-start", padding: 0, border: "none", background: "none", fontSize: 13, fontWeight: 600, color: item.deleteBlocker ? COLORS.slateLight : COLORS.danger, cursor: item.deleteBlocker ? "not-allowed" : "pointer" }}
        >
          Delete menu item
        </button>
      )}
    </MasterDataModal>
  );
}
