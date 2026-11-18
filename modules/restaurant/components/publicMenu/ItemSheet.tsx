"use client";

import { useEffect, useRef } from "react";
import { MENU_STRINGS as S } from "../../lib/menuStrings";
import type { MenuStatus, PublicMenuItem } from "../../lib/publicMenu";
import { ItemMedia } from "./ItemMedia";
import OrderForm from "./OrderForm";

// An item's detail (Part 8 Step 4): a full-screen sheet with its picture
// (photo, 360° or 3D), name, price, the whole description, allergens,
// calories and its option groups — read-only while guests can't order;
// with guest ordering on (Step 7), picked from, then Add to order.
// Everything it shows came with the menu, so it opens at once.

const INK = "#171b1c";
const QUIET = "#6d777a";
const LINE = "#eceff0";

export function LighterSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label data-lighter-menu style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: INK, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: "#0f7d6a" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <b style={{ fontWeight: 600 }}>{S.lighterMenu}</b>
        <span style={{ color: QUIET, fontSize: 12 }}>{S.lighterHelp}</span>
      </span>
    </label>
  );
}

export type SheetOrdering = { paused: boolean; accent: string; onAdd: (line: { modifierIds: string[]; note: string; quantity: number }) => void };

export default function ItemSheet({
  item,
  status,
  lighter,
  onLighter,
  onClose,
  ordering = null,
}: {
  item: PublicMenuItem;
  status: MenuStatus;
  lighter: boolean;
  onLighter: (on: boolean) => void;
  onClose: () => void;
  ordering?: SheetOrdering | null;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // The menu underneath doesn't scroll while the sheet is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const out = status !== "available";
  const canOrder = !!ordering && !ordering.paused && !out;
  const hasRich = !!(item.spinFrames || item.modelFiles);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} data-item-sheet={item.id} style={{ position: "fixed", inset: 0, zIndex: 20, background: "#fff", overflowY: "auto", WebkitOverflowScrolling: "touch", animation: "menu-sheet-in .18s ease-out" }}>
      <style>{`@keyframes menu-sheet-in { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }`}</style>
      <div style={{ maxWidth: 640, margin: "0 auto", position: "relative" }}>
        <ItemMedia item={item} lighter={lighter} />
        <button
          ref={close}
          type="button"
          aria-label={S.close}
          data-item-close
          onClick={onClose}
          style={{ position: "absolute", top: 12, left: 12, width: 38, height: 38, borderRadius: 19, border: "none", background: "rgba(255,255,255,.92)", color: INK, fontSize: 22, lineHeight: "38px", boxShadow: "0 2px 8px rgba(0,0,0,.18)", cursor: "pointer", zIndex: 2 }}
        >
          ×
        </button>

        <div style={{ padding: "16px 18px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <h2 style={{ margin: 0, flex: 1, fontSize: 21, fontWeight: 650, lineHeight: 1.25, color: INK }}>{item.name}</h2>
            {item.price && (
              <span data-item-price style={{ fontSize: 17, fontWeight: 650, color: "#0a6355", whiteSpace: "nowrap" }}>
                {item.price}
              </span>
            )}
          </div>
          {(item.signature || out) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {item.signature && <span style={{ padding: "3px 9px", borderRadius: 10, background: "#e7f4f1", color: "#0a6355", fontSize: 12, fontWeight: 600 }}>{S.signature}</span>}
              {out && (
                <span data-item-state style={{ padding: "3px 9px", borderRadius: 10, background: status === "sold_out" ? "#fdf2e9" : "#f1f4f4", color: status === "sold_out" ? "#9a4a12" : "#4d5659", fontSize: 12, fontWeight: 600 }}>
                  {status === "sold_out" ? S.soldOut : S.unavailable}
                </span>
              )}
            </div>
          )}
          {item.description && <p style={{ margin: 0, fontSize: 14.5, color: "#4d5659", lineHeight: 1.5 }}>{item.description}</p>}

          {(item.allergens.length > 0 || item.calories !== null) && (
            <div data-item-facts style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 10, background: "#f6f8f8" }}>
              {item.allergens.length > 0 && (
                <span style={{ fontSize: 13, color: INK }}>
                  <b style={{ fontWeight: 600 }}>{S.allergens}:</b> {item.allergens.join(", ")}
                </span>
              )}
              {item.calories !== null && <span style={{ fontSize: 13, color: INK }}>{S.calories(item.calories)}</span>}
            </div>
          )}

          {canOrder && ordering && <OrderForm item={item} accent={ordering.accent} onAdd={ordering.onAdd} />}
          {ordering?.paused && !out && (
            <p data-ordering-paused role="status" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "#fdf2e9", color: "#9a4a12", fontSize: 13.5 }}>
              {S.orderingPaused}
            </p>
          )}

          {!canOrder && item.modifiers.length > 0 && (
            <div data-item-options style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: QUIET }}>{S.options}</span>
              {item.modifiers.map((group) => (
                <div key={group.id} data-item-group={group.name} style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 6, borderBottom: `1px solid ${LINE}` }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{group.name}</span>
                    {group.rule && <span style={{ fontSize: 12, color: QUIET }}>{group.rule}</span>}
                  </div>
                  {group.options.map((option) => (
                    <div key={option.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${LINE}`, fontSize: 14, color: INK }}>
                      <span>{option.name}</span>
                      {option.price && <span style={{ color: QUIET, whiteSpace: "nowrap" }}>{option.price}</span>}
                    </div>
                  ))}
                </div>
              ))}
              {!ordering && <span style={{ fontSize: 12.5, color: QUIET }}>{S.optionsReadOnly}</span>}
            </div>
          )}

          {hasRich && (
            <div style={{ marginTop: 8, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
              <LighterSwitch on={lighter} onChange={onLighter} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
