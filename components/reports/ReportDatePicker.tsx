"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { rangeLabel } from "@/components/purchases/PurchaseFilters";
import {
  lastNDaysRange,
  thisMonthRange,
  thisWeekRange,
  thisYearRange,
  todayRange,
  type DateRange,
} from "@/lib/dateRanges";

const labelStyle: CSSProperties = { fontSize: 12.5, fontWeight: 600, color: COLORS.text };

const fieldStyle: CSSProperties = {
  width: "100%",
  height: 38,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 13.5,
  outline: "none",
  background: "#fff",
  color: COLORS.ink,
};

// Quick ranges on the app calendar (lib/dateRanges.ts — Africa/Lagos days).
const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: () => todayRange() },
  { label: "Last 7 days", range: () => lastNDaysRange(7) },
  { label: "This week", range: () => thisWeekRange() },
  { label: "This month", range: () => thisMonthRange() },
  { label: "This year", range: () => thisYearRange() },
];

// The Reports design's "Select Date" box: shows the applied ?from&to and opens
// a panel of quick ranges plus a custom From / To. Writes the same params as
// the Filters panel, so the two always agree.
export default function ReportDatePicker({ width = 220 }: { width?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { value: isOpen, on: open, off: close } = useToggleState();
  const containerRef = useRef<HTMLDivElement>(null);

  const appliedFrom = searchParams.get("from") ?? "";
  const appliedTo = searchParams.get("to") ?? "";

  const [from, setFrom] = useState(appliedFrom);
  const [to, setTo] = useState(appliedTo);
  // Computed when the panel opens (not at render) so "today" is current.
  const [presets, setPresets] = useState<{ label: string; range: DateRange }[]>([]);

  function openPanel() {
    setFrom(appliedFrom);
    setTo(appliedTo);
    setPresets(PRESETS.map((preset) => ({ label: preset.label, range: preset.range() })));
    open();
  }

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close]);

  function apply(next: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    // Swap a reversed range rather than returning nothing.
    const [start, end] = next.from && next.to && next.from > next.to ? [next.to, next.from] : [next.from, next.to];
    for (const [key, value] of [
      ["from", start],
      ["to", end],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    close();
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width }}>
      <input
        readOnly
        aria-label="Select Date"
        placeholder="Select Date"
        value={rangeLabel(appliedFrom, appliedTo)}
        onClick={isOpen ? close : openPanel}
        style={{
          width: "100%",
          height: 40,
          border: `1px solid ${isOpen ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          padding: "0 40px 0 14px",
          fontSize: 13.5,
          outline: "none",
          background: "#fff",
          cursor: "pointer",
          boxShadow: isOpen ? `0 0 0 3px ${COLORS.focusRing}` : "none",
          textOverflow: "ellipsis",
        }}
      />
      <Calendar
        size={15}
        strokeWidth={1.5}
        color={COLORS.slateMid}
        style={{ position: "absolute", right: 14, top: 12, pointerEvents: "none" }}
      />

      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 48,
            zIndex: 30,
            width: 320,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            animation: "elv-pop .12s ease-out",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {presets.map(({ label, range }) => {
              const active = range.from === appliedFrom && range.to === appliedTo;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => apply(range)}
                  style={{
                    height: 30,
                    padding: "0 11px",
                    background: active ? COLORS.tealTint : "#fff",
                    border: `1px solid ${active ? COLORS.tealBorder : COLORS.borderStrong}`,
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: active ? COLORS.tealDark : COLORS.text,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>From</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>To</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => apply({ from: "", to: "" })}
              style={{
                height: 34,
                padding: "0 14px",
                background: "#fff",
                border: `1px solid ${COLORS.borderStrong}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.text,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => apply({ from, to })}
              style={{
                height: 34,
                padding: "0 14px",
                background: COLORS.teal,
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
