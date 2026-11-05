"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { KDS } from "../../lib/theme";
import type { WasteItemOption } from "../../server/queries/waste";

const MAX_SHOWN = 8;
const TYPE_LABEL: Record<WasteItemOption["type"], string> = { MENU_ITEM: "Menu item", INGREDIENT: "Ingredient" };

// The Log waste item picker: type part of a menu item's or ingredient's name
// or code and pick it from the list (arrows + Enter, or click). Typing again
// clears the pick. `dark`: the kitchen display's colours and 48px rows.
export default function WasteItemPicker({
  items,
  value,
  onChange,
  hasError,
  autoFocus,
  dark = false,
}: {
  items: WasteItemOption[];
  value: WasteItemOption | null;
  onChange: (item: WasteItemOption | null) => void;
  hasError?: boolean;
  autoFocus?: boolean;
  dark?: boolean;
}) {
  const c = dark
    ? { bg: KDS.card, border: KDS.buttonBorder, focus: KDS.qty, text: KDS.text, sub: KDS.muted, list: KDS.header, hl: KDS.divider, menu: KDS.qty, ing: KDS.soft, height: 48, row: 48 }
    : { bg: "#fff", border: COLORS.borderStrong, focus: COLORS.teal, text: COLORS.ink, sub: COLORS.slateLight, list: "#fff", hl: COLORS.tealTint, menu: COLORS.tealDark, ing: COLORS.slateMid, height: 40, row: 0 };
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const focus = useToggleState();

  const needle = text.trim().toLowerCase();
  const matches = (value && text === value.name ? [] : items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle))).slice(0, MAX_SHOWN);
  const showList = open && matches.length > 0;

  function pick(item: WasteItemOption) {
    setText(item.name);
    setOpen(false);
    onChange(item);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => (matches.length ? (h + step + matches.length) % matches.length : 0));
    } else if (event.key === "Enter" && showList) {
      // Picks; doesn't submit the form.
      event.preventDefault();
      pick(matches[Math.min(highlight, matches.length - 1)]);
    } else if (event.key === "Escape" && showList) {
      // Closes the list, not the pop-up. React listens on the document (Next
      // hydrates the whole page), as the pop-up's Escape does, and was
      // there first — so this stops the pop-up's listener on the same node.
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        role="combobox"
        aria-label="Item"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Search menu items and ingredients"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setHighlight(0);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => {
          focus.on();
          setOpen(true);
        }}
        onBlur={() => {
          focus.off();
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          height: c.height,
          border: `1px solid ${hasError ? COLORS.danger : focus.value ? c.focus : c.border}`,
          borderRadius: 8,
          padding: "0 12px 0 34px",
          fontSize: dark ? 16 : 14,
          outline: "none",
          background: c.bg,
          color: c.text,
          boxShadow: focus.value && !dark ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        }}
      />
      <Search size={14} strokeWidth={1.8} color={dark ? KDS.muted : COLORS.slateMid} style={{ position: "absolute", left: 12, top: (c.height - 14) / 2, pointerEvents: "none" }} />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Items"
          style={{ position: "absolute", left: 0, right: 0, top: c.height + 4, zIndex: 5, margin: 0, padding: 4, listStyle: "none", background: c.list, border: `1px solid ${dark ? KDS.buttonBorder : COLORS.border}`, borderRadius: 10, boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)", maxHeight: 280, overflowY: "auto" }}
        >
          {matches.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === highlight}
              data-option={item.code}
              // Before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setHighlight(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", minHeight: c.row, borderRadius: 7, cursor: "pointer", background: i === highlight ? c.hl : "transparent", color: c.text, fontSize: dark ? 15 : 13.5 }}
            >
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: c.sub }}>
                  {item.code} · {item.unit}
                </span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: item.type === "MENU_ITEM" ? c.menu : c.ing }}>{TYPE_LABEL[item.type]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
