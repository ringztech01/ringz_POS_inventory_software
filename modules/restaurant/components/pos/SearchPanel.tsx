"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { shortPrice } from "../../lib/optionFlow";
import { searchDishes } from "../../lib/posSpeed";
import { TOUCH } from "../../lib/theme";
import type { MenuCard } from "../../server/queries/orderScreen";
import OnScreenKeyboard from "./OnScreenKeyboard";
import PanelFrame from "./PanelFrame";
import TouchButton from "./TouchButton";

// Quick search for the rare dish: type (on screen or a desk keyboard) and
// the matches show as keys like the grid's; a tap adds it like a grid key.
export default function SearchPanel({ items, colourOf, onPick, onCancel }: { items: MenuCard[]; colourOf: (id: string) => string; onPick: (item: MenuCard) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const latest = useRef(query);
  const update = (next: string) => {
    latest.current = next.slice(0, 40);
    setQuery(latest.current);
  };
  const hits = searchDishes(items, query, 12);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") update(latest.current.slice(0, -1));
      else if (event.key.length === 1) update(latest.current + event.key);
      else return;
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PanelFrame label="Search dishes" title="Search" hint="A name or a code" onCancel={onCancel}>
      <span data-search-text style={{ minHeight: 44, padding: "0 12px", borderRadius: TOUCH.radius, background: TOUCH.check, color: TOUCH.ink, fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Search size={18} strokeWidth={1.8} color={TOUCH.inkFaint} />
        {query || <span style={{ color: TOUCH.inkFaint, fontSize: 15 }}>Type part of a name or code</span>}
      </span>
      <div data-search-results style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gridTemplateRows: "repeat(2, 64px)", gap: TOUCH.gap, flexShrink: 0 }}>
        {Array.from({ length: 12 }, (_, i) => hits[i] ?? null).map((item, i) =>
          item ? (
            <TouchButton
              key={item.id}
              data-search-hit={item.name}
              background={item.unavailable ? TOUCH.outBg : colourOf(item.id)}
              color={item.unavailable ? TOUCH.outInk : "#fff"}
              disabled={item.unavailable !== null}
              onClick={() => onPick(item)}
              style={{ display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "space-between", padding: "6px 8px", textAlign: "left" }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.15, overflowWrap: "anywhere" }}>{item.name}</span>
              <span style={{ fontFamily: TOUCH.mono, fontSize: 12, fontWeight: 600 }}>{item.unavailable ? "86" : shortPrice(item.price)}</span>
            </TouchButton>
          ) : (
            <div key={`none-${i}`} aria-hidden style={{ background: TOUCH.empty, borderRadius: TOUCH.radius }} />
          ),
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid" }}>
        <OnScreenKeyboard onKey={(key) => update(latest.current + key)} onDelete={() => update(latest.current.slice(0, -1))} onClear={() => update("")} />
      </div>
    </PanelFrame>
  );
}
