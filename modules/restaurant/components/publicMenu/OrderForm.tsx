"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { checkSelection } from "../../lib/modifiers";
import { GUEST_LINE_QTY_MAX, GUEST_NOTE_MAX } from "../../lib/guestOrdering";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import type { PublicMenuItem, PublicModifierGroup } from "../../lib/publicMenu";
import { menuMoney } from "./menuMoney";

// Guest ordering's part of an item's sheet (Part 8 Step 7): its option
// groups to pick from — the POS's own rule (lib/modifiers checkSelection:
// required groups, min / max), so Add is off until they're met — then how
// many, a note for the kitchen, and Add to order with what it comes to.
// The price shown is the menu's; the server prices the order itself.

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const INK = "#171b1c";
const QUIET = "#6d777a";
const LINE = "#eceff0";

function groupHint(group: PublicModifierGroup): string {
  if (group.min === group.max) return group.min === 1 ? S.pickOne : S.pickExactly(group.min);
  if (group.min === 0) return group.max === 1 ? "" : S.pickUpTo(group.max);
  return S.pickBetween(group.min, group.max);
}

export default function OrderForm({ item, accent, onAdd }: { item: PublicMenuItem; accent: string; onAdd: (line: { modifierIds: string[]; note: string; quantity: number }) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const rules = item.modifiers.map((g) => ({ id: g.id, name: g.name, minSelect: g.min, maxSelect: g.max, optionIds: g.options.map((o) => o.id) }));
  const problem = checkSelection(rules, picked);

  const toggle = (group: PublicModifierGroup, optionId: string) => {
    const mine = group.options.map((o) => o.id);
    setPicked((before) => {
      if (before.includes(optionId)) return before.filter((id) => id !== optionId);
      // One choice: picking another swaps it.
      if (group.max === 1) return [...before.filter((id) => !mine.includes(id)), optionId];
      if (before.filter((id) => mine.includes(id)).length >= group.max) return before;
      return [...before, optionId];
    });
  };

  const unit =
    item.kobo === null
      ? null
      : item.kobo + item.modifiers.flatMap((g) => g.options).filter((o) => picked.includes(o.id)).reduce((sum, o) => sum + (o.kobo ?? 0), 0);

  return (
    <div data-order-form style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
      {item.modifiers.map((group) => {
        const count = group.options.filter((o) => picked.includes(o.id)).length;
        const missing = count < group.min;
        return (
          <fieldset key={group.id} data-order-group={group.name} style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            <legend style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", paddingBottom: 6, borderBottom: `1px solid ${LINE}` }}>
              <span style={{ fontSize: 15, fontWeight: 650, color: INK }}>{group.name}</span>
              {group.min > 0 && (
                <span data-order-required={missing ? "missing" : "met"} style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: missing ? "#fdf2e9" : "#e7f4f1", color: missing ? "#9a4a12" : "#0a6355" }}>
                  {S.required}
                </span>
              )}
              <span style={{ fontSize: 12, color: QUIET }}>{groupHint(group)}</span>
            </legend>
            {group.options.map((option) => {
              const on = picked.includes(option.id);
              return (
                <label key={option.id} data-order-option={option.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${LINE}`, fontSize: 14.5, color: INK, cursor: "pointer" }}>
                  <input
                    type={group.max === 1 ? "radio" : "checkbox"}
                    name={`group-${group.id}`}
                    checked={on}
                    onChange={() => toggle(group, option.id)}
                    onClick={(e) => {
                      // A single-choice option that's on: a second tap takes it off (optional groups).
                      if (group.max === 1 && on && group.min === 0) {
                        e.preventDefault();
                        toggle(group, option.id);
                      }
                    }}
                    style={{ width: 20, height: 20, accentColor: accent, margin: 0 }}
                  />
                  <span style={{ flex: 1 }}>{option.name}</span>
                  {option.price && <span style={{ color: QUIET, whiteSpace: "nowrap" }}>{option.price}</span>}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{S.noteLabel}</span>
        <input
          data-order-note
          value={note}
          maxLength={GUEST_NOTE_MAX}
          placeholder={S.notePlaceholder}
          onChange={(e) => setNote(e.target.value)}
          style={{ height: 44, border: "1px solid #dde2e3", borderRadius: 10, padding: "0 12px", fontSize: 15, fontFamily: FONT, color: INK, background: "#fff" }}
        />
      </label>

      <div style={{ position: "sticky", bottom: 0, background: "#fff", padding: "10px 0 calc(6px + env(safe-area-inset-bottom))", display: "flex", gap: 10, alignItems: "center", borderTop: `1px solid ${LINE}` }}>
        <div role="group" aria-label={S.quantity} style={{ display: "flex", alignItems: "center", border: "1px solid #dde2e3", borderRadius: 12, height: 50 }}>
          <button type="button" aria-label={S.less} data-order-less disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))} style={{ width: 44, height: 48, border: "none", background: "none", color: quantity <= 1 ? "#c5cbcd" : INK, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Minus size={18} aria-hidden />
          </button>
          <span data-order-qty aria-live="polite" style={{ minWidth: 26, textAlign: "center", fontSize: 16, fontWeight: 700, color: INK }}>
            {quantity}
          </span>
          <button type="button" aria-label={S.more} data-order-more disabled={quantity >= GUEST_LINE_QTY_MAX} onClick={() => setQuantity((q) => Math.min(GUEST_LINE_QTY_MAX, q + 1))} style={{ width: 44, height: 48, border: "none", background: "none", color: INK, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={18} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          data-order-add
          disabled={!!problem}
          title={problem ?? undefined}
          onClick={() => onAdd({ modifierIds: picked, note: note.trim(), quantity })}
          style={{ flex: 1, height: 50, border: "none", borderRadius: 12, background: problem ? "#c5cbcd" : accent, color: "#fff", fontFamily: FONT, fontSize: 15.5, fontWeight: 700, cursor: problem ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {S.addToOrder}
          {unit !== null && <span style={{ fontWeight: 600, opacity: 0.9 }}>· {menuMoney(unit * quantity, item.price)}</span>}
        </button>
      </div>
      {problem && item.modifiers.length > 0 && (
        <span data-order-problem style={{ fontSize: 12.5, color: "#9a4a12", marginTop: -8 }}>
          {problem}
        </span>
      )}
    </div>
  );
}
