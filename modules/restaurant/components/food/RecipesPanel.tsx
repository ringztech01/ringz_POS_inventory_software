"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronDown, Trash2 } from "lucide-react";
import { Field, SelectInput } from "@/components/purchases/form-fields";
import { COLORS, FONTS } from "@/components/layout/theme";
import IconActionButton from "@/components/ui/IconActionButton";
import ReportTable, { type ReportColumn } from "@/components/reports/ReportTable";
import { formatNaira } from "@/lib/format";
import { R } from "../../lib/theme";
import { INGREDIENT_NAME_MAX, type RecipeLineField } from "../../schemas/recipe";
import { addRecipeLine, deleteRecipeLine } from "../../server/actions/recipes";
import type { IngredientOption, RecipeItemOption, RecipeLineRow, RecipeView } from "../../server/queries/recipes";
import TextInput from "../TextInput";

// Food › Recipes: pick a menu item (?item=), see what one serving uses —
// each ingredient's quantity in its own unit, cost per unit and line cost —
// with the food cost and margin; add and remove ingredients. The Add form
// stays put when another item is picked. A typed name that isn't an
// ingredient yet becomes a new one (with its unit and cost per unit).

const label = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid } as const;

export default function RecipesPanel({
  items,
  recipe,
  ingredients,
  units,
}: {
  items: RecipeItemOption[];
  recipe: RecipeView | null;
  ingredients: IngredientOption[];
  units: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RecipeLineField, string[]>>>({});
  const [isAdding, startAdd] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const match = ingredients.find((i) => i.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  const isNew = name.trim() !== "" && !match;
  const unitShown = match ? match.unit : unit;

  function pickItem(id: string) {
    router.replace(`${pathname}?item=${id}`, { scroll: false });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipe || isAdding) return;
    setFieldErrors({});
    startAdd(async () => {
      const result = await addRecipeLine({
        menuItemId: recipe.item.id,
        ingredientId: match?.id ?? "",
        name: match ? "" : name,
        unit: match ? "" : unit,
        cost: match ? "" : cost,
        quantity,
      });
      if (result.ok) {
        toast.success(`${(match?.name ?? name).trim()} added to ${recipe.item.name}${isNew ? " (new ingredient)" : ""}.`);
        setName("");
        setQuantity("");
        setUnit("");
        setCost("");
        router.refresh();
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
      }
    });
  }

  async function remove(line: RecipeLineRow) {
    setRemoving(line.id);
    try {
      const result = await deleteRecipeLine(line.id);
      if (result.ok) toast.success(`${line.ingredient} removed from the recipe.`);
      else toast.error(result.error);
    } finally {
      setRemoving(null);
      router.refresh();
    }
  }

  const columns: ReportColumn<RecipeLineRow>[] = [
    { label: "Ingredient", width: "minmax(160px,2fr)", render: (row) => <span style={{ fontWeight: 600 }}>{row.ingredient}</span> },
    {
      label: "Qty",
      width: "minmax(100px,1fr)",
      align: "right",
      render: (row) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {row.partUnit && (
            <span
              data-part-unit
              title="Recipes take whole units now: remove this line and add it again in a small unit (e.g. 250 g). Until then, bills with this dish can't be settled."
              style={{ fontSize: 11, fontWeight: 600, color: COLORS.danger, background: COLORS.dangerBg, borderRadius: 6, padding: "1px 6px", fontFamily: FONTS.body }}
            >
              Part unit
            </span>
          )}
          <span style={{ fontFamily: FONTS.mono }}>
            {row.quantity} {row.unit}
          </span>
        </span>
      ),
    },
    {
      label: "Cost per unit",
      width: "minmax(110px,1fr)",
      align: "right",
      render: (row) => (
        <span style={{ fontFamily: FONTS.mono, color: row.unitCost ? COLORS.slate : COLORS.slateLight }} title={row.unitCost ? undefined : "No cost set for this ingredient — counted as ₦0"}>
          {row.unitCost ? `${formatNaira(row.unitCost)}/${row.unit}` : "—"}
        </span>
      ),
    },
    { label: "Line cost", width: "minmax(100px,1fr)", align: "right", render: (row) => <span style={{ fontFamily: FONTS.mono, fontWeight: 600 }}>{formatNaira(row.lineCost)}</span> },
    {
      label: "",
      width: "44px",
      align: "right",
      render: (row) => (
        <IconActionButton icon={<Trash2 size={13} strokeWidth={1.8} />} title={`Remove ${row.ingredient}`} tone="danger" size={28} disabled={removing === row.id} onClick={() => void remove(row)} />
      ),
    },
  ];

  if (items.length === 0) {
    return (
      <section aria-label="Recipe" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18 }}>
        <p data-empty style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
          No menu items yet. <Link href="/restaurant/food/items">Add one in Menu items</Link>, then give it a recipe here.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Recipe" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Recipe for</h2>
        <div style={{ position: "relative" }}>
          <select
            aria-label="Menu item"
            value={recipe?.item.id ?? ""}
            onChange={(event) => pickItem(event.target.value)}
            style={{ appearance: "none", height: 38, minWidth: 240, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 30px 0 10px", fontSize: 13.5, fontWeight: 600, background: "#fff", cursor: "pointer", outline: "none" }}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </select>
          <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 10, top: 13, pointerEvents: "none" }} />
        </div>
        {recipe && (
          <span data-item-summary style={{ fontSize: 13, color: COLORS.slateMid }}>
            <span style={{ fontFamily: FONTS.mono }}>{recipe.item.code}</span> · {formatNaira(recipe.item.price)}
          </span>
        )}
        {recipe && (
          <span data-food-cost style={{ marginLeft: "auto", fontSize: 13.5 }}>
            <span style={{ color: COLORS.slateMid }}>Food cost </span>
            <span style={{ fontWeight: 600 }}>{recipe.foodCost === null ? "No recipe" : `${formatNaira(recipe.foodCost)} · ${recipe.margin === null ? "—" : `${recipe.margin}% margin`}`}</span>
          </span>
        )}
      </div>

      {recipe && recipe.lines.length === 0 ? (
        <p data-no-recipe style={{ margin: 0, padding: "16px 18px", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          No recipe. This item tracks its own stock like a retail product. Add ingredients below to deduct them instead when it&apos;s billed.
        </p>
      ) : (
        recipe && <ReportTable columns={columns} rows={recipe.lines} rowKey={(row) => row.id} minWidth={560} rowHeight={48} flush emptyMessage="" />
      )}

      <form onSubmit={add} aria-label="Add ingredient" noValidate style={{ padding: "16px 18px", borderTop: `1px solid ${COLORS.border}`, background: COLORS.bgInput, display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={label}>Add ingredient</span>
        <div style={{ display: "grid", gridTemplateColumns: isNew ? "minmax(0,2fr) 110px minmax(0,1fr) 120px auto" : "minmax(0,2fr) 140px auto", gap: 12, alignItems: "end" }}>
          <Field label="Ingredient" required error={fieldErrors.name?.[0]}>
            <input
              list="recipe-ingredients"
              aria-label="Ingredient"
              value={name}
              maxLength={INGREDIENT_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="Start typing — e.g. Basmati rice"
              style={{ height: 40, border: `1px solid ${fieldErrors.name ? COLORS.danger : COLORS.borderStrong}`, borderRadius: 8, padding: "0 12px", fontSize: 13.5, outline: "none", background: "#fff" }}
            />
            <datalist id="recipe-ingredients">
              {ingredients.map((i) => (
                <option key={i.id} value={i.name}>
                  {i.unit}
                  {i.cost ? ` · ₦${i.cost}/${i.unit}` : ""}
                </option>
              ))}
            </datalist>
          </Field>
          {isNew && (
            <Field label="Unit" required error={fieldErrors.unit?.[0]}>
              <SelectInput value={unit} onChange={setUnit} options={units.map((u) => ({ value: u, label: u }))} placeholder="Unit" hasError={!!fieldErrors.unit} />
            </Field>
          )}
          {isNew && (
            <Field label="Cost per unit (₦)" error={fieldErrors.cost?.[0]}>
              <TextInput value={cost} onChange={setCost} placeholder="Optional" maxLength={12} hasError={!!fieldErrors.cost} ariaLabel="Cost per unit" />
            </Field>
          )}
          <Field label={`Qty per serving${unitShown ? ` (${unitShown})` : ""}`} required error={fieldErrors.quantity?.[0]}>
            <TextInput value={quantity} onChange={setQuantity} placeholder="e.g. 250" maxLength={6} hasError={!!fieldErrors.quantity} ariaLabel="Quantity" />
          </Field>
          <button
            type="submit"
            disabled={isAdding || !recipe}
            style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: isAdding ? COLORS.slateLight : COLORS.teal, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: isAdding ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
          >
            {isAdding ? "Adding…" : "Add ingredient"}
          </button>
        </div>
        <p data-ingredient-hint style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>
          {match
            ? `${match.name}: measured in ${match.unit}${match.cost ? `, ${formatNaira(match.cost)} per ${match.unit}` : ", no cost set yet (counts as ₦0)"}.`
            : isNew
              ? `“${name.trim()}” isn't an ingredient yet — it'll be created with this unit and cost.`
              : "Quantities are per serving, in the ingredient's own unit. Costs come from each ingredient's cost per unit."}
        </p>
      </form>
    </section>
  );
}
