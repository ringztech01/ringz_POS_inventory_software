"use client";

import { useState } from "react";
import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { ORDER_SCREEN } from "../../lib/theme";
import type { MenuCard, OrderScreenData } from "../../server/queries/orderScreen";
import { AVAILABILITY_TAG } from "../../lib/menuAvailability";

function DishCard({ item, disabled, onPick }: { item: MenuCard; disabled: boolean; onPick: (item: MenuCard) => void }) {
  const hover = useToggleState();
  const blocked = disabled || item.unavailable !== null;
  const state = item.unavailable === "off" ? AVAILABILITY_TAG.unavailable : item.unavailable === "out" ? AVAILABILITY_TAG.out_of_stock : null;
  const tag = state ? state.tag : item.hasOptions ? "Options" : "";
  return (
    <button
      type="button"
      data-dish={item.name}
      disabled={blocked}
      onClick={() => onPick(item)}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      title={state?.title}
      style={{
        background: "#fff",
        border: `1px solid ${hover.value && !blocked ? ORDER_SCREEN.cardHoverBorder : ORDER_SCREEN.cardBorder}`,
        borderRadius: 12,
        padding: 0,
        overflow: "hidden",
        cursor: blocked ? "not-allowed" : "pointer",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        opacity: item.unavailable ? 0.5 : 1,
      }}
    >
      <div
        style={{
          height: 92,
          background: item.image ? `${ORDER_SCREEN.photo} url(${JSON.stringify(item.image)}) center / cover no-repeat` : ORDER_SCREEN.photo,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.slateLight,
        }}
      >
        {!item.image && <UtensilsCrossed size={20} strokeWidth={1.4} />}
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.ink }}>{item.name}</span>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 600, color: COLORS.tealDark }}>{item.price}</span>
          <span style={{ fontSize: 11.5, color: item.unavailable ? ORDER_SCREEN.unavailable : COLORS.slateMid }}>{tag}</span>
        </div>
      </div>
    </button>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        height: 34,
        padding: "0 14px",
        borderRadius: 17,
        border: `1px solid ${on ? COLORS.teal : ORDER_SCREEN.chipBorder}`,
        background: on ? COLORS.teal : "#fff",
        color: on ? "#fff" : COLORS.slate,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// The order screen's left side (Table Order design): back to the floor, dish
// search (name or code), category chips (only categories with menu items)
// and the dish grid. Dishes switched off or out of stock in the order's
// warehouse are dimmed and can't be tapped.
export default function MenuPanel({
  menu,
  floorHref,
  editable,
  onPick,
}: {
  menu: OrderScreenData["menu"];
  floorHref: string;
  editable: boolean;
  onPick: (item: MenuCard) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useToggleState();
  const needle = query.trim().toLowerCase();
  const items = menu.items.filter(
    (item) =>
      (!category || item.categoryId === category) &&
      (!needle || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle)),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      <div
        style={{
          height: 60,
          flex: "0 0 auto",
          background: "#fff",
          borderBottom: `1px solid ${COLORS.border}`,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 20px",
        }}
      >
        <Link
          href={floorHref}
          style={{ height: 36, padding: "0 12px", display: "flex", alignItems: "center", border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, color: COLORS.slate, fontSize: 13, fontWeight: 600, textDecoration: "none" }}
        >
          ← Floor
        </Link>
        <input
          aria-label="Search dishes"
          placeholder="Search dishes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={search.on}
          onBlur={search.off}
          style={{
            flex: 1,
            maxWidth: 420,
            height: 38,
            border: `1px solid ${search.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 12px",
            fontSize: 13.5,
            outline: "none",
            background: search.value ? "#fff" : COLORS.bgInput,
            boxShadow: search.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          }}
        />
        <Link href="/restaurant/kitchen" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: COLORS.teal, textDecoration: "none" }}>
          Kitchen display
        </Link>
      </div>

      <div aria-label="Categories" style={{ display: "flex", gap: 8, padding: "16px 20px 0", flexWrap: "wrap" }}>
        <Chip label="All" on={category === null} onClick={() => setCategory(null)} />
        {menu.categories.map((c) => (
          <Chip key={c.id} label={c.name} on={category === c.id} onClick={() => setCategory(c.id)} />
        ))}
      </div>

      <div
        aria-label="Dishes"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: 12,
          alignContent: "start",
        }}
      >
        {items.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, gridColumn: "1 / -1" }}>
            {menu.items.length === 0 ? "No menu items yet. They're added on the Food screen." : "No dishes match."}
          </p>
        ) : (
          items.map((item) => <DishCard key={item.id} item={item} disabled={!editable} onPick={onPick} />)
        )}
      </div>
    </div>
  );
}
