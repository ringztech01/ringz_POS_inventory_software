"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

type SearchableProduct = { id: string; name: string; code: string };

// Debounced "Search Product by Code Name" field with a results dropdown.
// Shared by document forms (Purchases now, Sales later). The caller supplies
// the search function (a server action) and decides what selecting a result
// does; `searchKey` re-runs the search when context such as the selected
// warehouse changes.
export default function ProductSearchField<T extends SearchableProduct>({
  search,
  searchKey = "",
  onSelect,
  renderMeta,
  disabled,
  disabledHint,
  placeholder = "Search Product by Code Name",
}: {
  search: (query: string) => Promise<T[]>;
  searchKey?: string;
  onSelect: (product: T) => void;
  renderMeta?: (product: T) => ReactNode;
  disabled?: boolean;
  disabledHint?: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  // Results are stored with the request they answer. Anything that doesn't
  // match the current request is ignored, so a slow earlier response can
  // never overwrite a newer one, and "searching" is simply "no answer yet".
  const [response, setResponse] = useState<{ key: string; results: T[] } | null>(null);
  const focus = useToggleState();

  const trimmed = query.trim();
  const requestKey = `${searchKey}\u0000${trimmed}`;
  const isActive = !disabled && trimmed.length > 0;
  const isSearching = isActive && response?.key !== requestKey;
  const results = isActive && response?.key === requestKey ? response.results : [];

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      const found = await search(trimmed);
      if (!cancelled) setResponse({ key: requestKey, results: found });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // `search` is usually an inline closure; searchKey (part of requestKey)
    // stands in for its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, isActive]);

  function select(product: T) {
    onSelect(product);
    setQuery("");
  }

  const showDropdown = isActive && focus.value;

  return (
    <div style={{ position: "relative" }}>
      <Search size={15} strokeWidth={1.6} color={COLORS.slateMid} style={{ position: "absolute", left: 12, top: 12 }} />
      <input
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={focus.on}
        onBlur={focus.off}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setQuery("");
          } else if (event.key === "Enter") {
            // Enter picks the only/first result instead of submitting the form.
            event.preventDefault();
            if (!isSearching && results.length > 0) select(results[0]);
          }
        }}
        style={{
          width: "100%",
          height: 40,
          border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 12px 0 34px",
          fontSize: 14,
          outline: "none",
          background: disabled ? COLORS.bgApp : "#fff",
          color: disabled ? COLORS.slateLight : COLORS.text,
          cursor: disabled ? "not-allowed" : "text",
          boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
        }}
      />

      {disabled && disabledHint && (
        <span style={{ display: "block", marginTop: 6, fontSize: 12, color: COLORS.slateMid }}>{disabledHint}</span>
      )}

      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: 44,
            left: 0,
            right: 0,
            zIndex: 20,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 6,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {isSearching && <div style={{ padding: 10, fontSize: 13, color: COLORS.slateMid }}>Searching…</div>}
          {!isSearching && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 13, color: COLORS.slateMid }}>No products found.</div>
          )}
          {!isSearching &&
            results.map((product) => (
              <ResultRow key={product.id} onPick={() => select(product)} meta={renderMeta?.(product)}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: COLORS.text }}>{product.name}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateMid }}>{product.code}</span>
              </ResultRow>
            ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({ onPick, meta, children }: { onPick: () => void; meta?: ReactNode; children: ReactNode }) {
  const hover = useToggleState();

  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      // mousedown (not click) so the pick happens before the input's blur
      // closes the dropdown.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        background: hover.value ? COLORS.bgApp : "transparent",
        border: "none",
        padding: "9px 10px",
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>{children}</span>
      {meta}
    </button>
  );
}
