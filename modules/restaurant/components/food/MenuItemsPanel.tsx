"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronDown, ListChecks, Pencil } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import IconActionButton from "@/components/ui/IconActionButton";
import Pagination from "@/components/ui/Pagination";
import SearchInput from "@/components/ui/SearchInput";
import type { SelectOption } from "@/components/purchases/form-fields";
import { formatNaira } from "@/lib/format";
import { R } from "../../lib/theme";
import { deleteMenuItem } from "../../server/actions/menuItems";
import type { MenuItemRow } from "../../server/queries/menuItems";
import type { ModifierGroupOption } from "../../server/queries/modifierList";
import ItemGroupsModal from "./ItemGroupsModal";
import FoodTabs from "./FoodTabs";
import MenuItemModal from "./MenuItemModal";
import MenuSwitch from "./MenuSwitch";

// Food › Menu items (RingzPOS Food Management design): the menu items with
// their category, price, station, recipe, and the Available / On menu
// switches (saved straight away); the selected row's recipe and modifier
// groups in the side panel. Search (?q) and category (?category) live in
// the URL, as does the page.

// Fits next to the side panel with the app sidebar open (1440px wide).
const GRID = "44px minmax(0,1.6fr) minmax(0,1fr) 80px 80px 88px 74px 66px 62px";
const head = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid } as const;
const label = { fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid } as const;

function CategoryFilter({ categories, value }: { categories: SelectOption[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("category", next);
    else params.delete("category");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div style={{ position: "relative" }}>
      <select
        aria-label="Category"
        value={value}
        onChange={(event) => change(event.target.value)}
        style={{ appearance: "none", height: 38, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 30px 0 10px", fontSize: 13.5, background: "#fff", cursor: "pointer", outline: "none" }}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} strokeWidth={1.8} color={COLORS.slateMid} style={{ position: "absolute", right: 10, top: 13, pointerEvents: "none" }} />
    </div>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{ height: 38, padding: "0 14px", background: hover.value ? COLORS.tealDark : COLORS.teal, border: "none", borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
    >
      + Add menu item
    </button>
  );
}

function SidePanel({ item }: { item: MenuItemRow | null }) {
  return (
    <aside aria-label="Recipe" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      {!item ? (
        <p style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>Pick a menu item to see its recipe and modifier groups.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={label}>Recipe</span>
            <span style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>{item.name}</span>
            <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>Ingredients deducted from stock each time this item is billed.</span>
          </div>
          {item.recipe.length === 0 ? (
            <p data-no-recipe style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>No recipe. This item tracks its own stock like a retail product.</p>
          ) : (
            <div>
              {item.recipe.map((line, i) => (
                <div key={i} data-recipe-line={line.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${R.rowBorder}`, fontSize: 13.5 }}>
                  <span style={{ flex: 1 }}>{line.name}</span>
                  <span style={{ fontFamily: FONTS.mono, color: COLORS.slate }}>
                    {line.quantity} {line.unit}
                  </span>
                  <span style={{ width: 72, textAlign: "right", color: COLORS.slateMid, fontSize: 12.5 }}>{formatNaira(line.cost)}</span>
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/restaurant/food/recipes?item=${item.id}`}
            style={{ height: 36, border: `1px dashed ${COLORS.tealBorder}`, background: "#fff", color: COLORS.tealDark, borderRadius: 8, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
          >
            + Add ingredient
          </Link>
          <div data-food-cost style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, paddingTop: 4 }}>
            <span style={{ color: COLORS.slateMid }}>Food cost</span>
            <span style={{ fontWeight: 600 }}>{item.foodCost === null ? "No recipe" : `${formatNaira(item.foodCost)} · ${item.margin === null ? "—" : `${item.margin}% margin`}`}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6, borderTop: `1px solid ${COLORS.border}` }}>
            <span style={label}>Modifier groups</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(item.groups.length ? item.groups : ["None"]).map((g) => (
                <span key={g} data-group={g} style={{ height: 28, padding: "0 10px", borderRadius: 14, background: COLORS.tealTint, color: COLORS.tealDark, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center" }}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

export default function MenuItemsPanel({
  rows,
  groups,
  categories,
  stations,
  categoryId,
  filtered,
  page,
  perPage,
  total,
  totalPages,
}: {
  rows: MenuItemRow[];
  // Every modifier group (the Modifiers pop-up).
  groups: ModifierGroupOption[];
  categories: SelectOption[];
  stations: SelectOption[];
  categoryId: string;
  // A search or category filter is on (for the empty message).
  filtered: boolean;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuItemRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<MenuItemRow | null>(null);
  const [groupsFor, setGroupsFor] = useState<MenuItemRow | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  function confirmDelete() {
    if (!deleting) return;
    startDelete(async () => {
      const result = await deleteMenuItem(deleting.id);
      setDeleting(null);
      if (result.ok) {
        toast.success(`${deleting.name} deleted.`);
        setEditing(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600 }}>Food</h1>
        <FoodTabs active="items" />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <Suspense fallback={null}>
            <CategoryFilter categories={categories} value={categoryId} />
            <SearchInput placeholder="Search menu items" width={240} height={38} />
          </Suspense>
          <AddButton onClick={() => setEditing("new")} />
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, alignItems: "start" }}>
        <section aria-label="Menu items" style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 700 }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "12px 16px", background: COLORS.bgInput, borderBottom: `1px solid ${COLORS.border}` }}>
                <span />
                <span style={head}>Item</span>
                <span style={head}>Category</span>
                <span style={head}>Price</span>
                <span style={head}>Station</span>
                <span style={head}>Recipe</span>
                <span style={head}>Available</span>
                <span style={head}>On menu</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <p data-empty style={{ margin: 0, padding: "28px 16px", fontSize: 13.5, color: COLORS.slateMid }}>
                  {filtered ? "No menu items match. Try another search or category." : "No menu items yet. Add your first dish with “+ Add menu item”."}
                </p>
              ) : (
                rows.map((row) => {
                  const on = row.id === selected?.id;
                  return (
                    <div
                      key={row.id}
                      data-menu-item={row.code}
                      aria-selected={on}
                      onClick={() => setSelectedId(row.id)}
                      style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "10px 16px", borderBottom: `1px solid ${R.rowBorder}`, alignItems: "center", fontSize: 13.5, cursor: "pointer", background: on ? "#f3faf8" : "#fff" }}
                    >
                      <span style={{ width: 40, height: 34, borderRadius: 7, background: COLORS.bgApp }} />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateLight }}>
                          {row.code} · {row.groups.length ? `${row.groups.length} modifier ${row.groups.length === 1 ? "group" : "groups"}` : "No modifiers"}
                        </span>
                      </div>
                      <span style={{ color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.category}</span>
                      <span style={{ fontWeight: 600 }}>{formatNaira(row.price)}</span>
                      <span style={{ color: row.station ? COLORS.slate : COLORS.slateLight }} title={row.station ? undefined : "No station: sent to the first active station"}>
                        {row.station ?? "—"}
                      </span>
                      <span style={{ fontSize: 12.5, color: row.recipe.length ? COLORS.tealDark : COLORS.slateMid }}>
                        {row.recipe.length ? `${row.recipe.length} ${row.recipe.length === 1 ? "ingredient" : "ingredients"}` : "Own stock"}
                      </span>
                      <MenuSwitch id={row.id} name={row.name} field="isAvailable" value={row.isAvailable} />
                      <MenuSwitch id={row.id} name={row.name} field="showOnMenu" value={row.showOnMenu} />
                      <span onClick={(event) => event.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                        <IconActionButton icon={<ListChecks size={13} strokeWidth={1.8} />} title={`Modifiers for ${row.name}`} size={28} onClick={() => setGroupsFor(row)} />
                        <IconActionButton icon={<Pencil size={13} strokeWidth={1.8} />} title={`Edit ${row.name}`} size={28} onClick={() => setEditing(row)} />
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <Suspense fallback={null}>
            <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
          </Suspense>
        </section>

        <SidePanel item={selected} />
      </div>

      {editing && (
        <MenuItemModal
          item={editing === "new" ? null : editing}
          categories={categories}
          stations={stations}
          onClose={() => setEditing(null)}
          onDelete={(item) => setDeleting(item)}
        />
      )}
      {groupsFor && <ItemGroupsModal item={groupsFor} groups={groups} onClose={() => setGroupsFor(null)} />}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete menu item"
          message={`Delete "${deleting.name}"? It leaves the menu and the order screen. Orders already billed keep it.`}
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
          pending={isDeleting}
        />
      )}
    </div>
  );
}
