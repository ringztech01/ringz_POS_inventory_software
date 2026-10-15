"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Funnel } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import type { FormOption } from "@/app/(dashboard)/purchases/types";

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

// "YYYY-MM-DD" → "MM/DD/YYYY", matching formatDateTime's date format. Done on
// the string directly so no timezone conversion can shift the day.
function displayDate(value: string, shortYear = false): string {
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${shortYear ? year.slice(2) : year}`;
}

function rangeLabel(from: string, to: string): string {
  // Two-digit years so a full range fits the design's 200px box.
  if (from && to) return `${displayDate(from, true)} – ${displayDate(to, true)}`;
  if (from) return `From ${displayDate(from)}`;
  if (to) return `Until ${displayDate(to)}`;
  return "";
}

export default function PurchaseFilters({ warehouses }: { warehouses: FormOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { value: isOpen, on: open, off: close } = useToggleState();
  const filtersHover = useToggleState();
  const containerRef = useRef<HTMLDivElement>(null);

  const appliedFrom = searchParams.get("from") ?? "";
  const appliedTo = searchParams.get("to") ?? "";
  const appliedWarehouse = searchParams.get("warehouse") ?? "";
  const activeCount = [appliedFrom || appliedTo, appliedWarehouse].filter(Boolean).length;

  const [from, setFrom] = useState(appliedFrom);
  const [to, setTo] = useState(appliedTo);
  const [warehouse, setWarehouse] = useState(appliedWarehouse);

  function openPanel() {
    // Start each edit from what's actually applied, not a stale draft.
    setFrom(appliedFrom);
    setTo(appliedTo);
    setWarehouse(appliedWarehouse);
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

  function apply(next: { from: string; to: string; warehouse: string }) {
    const params = new URLSearchParams(searchParams.toString());
    // Swap a reversed range rather than returning nothing.
    const [start, end] = next.from && next.to && next.from > next.to ? [next.to, next.from] : [next.from, next.to];
    for (const [key, value] of [
      ["from", start],
      ["to", end],
      ["warehouse", next.warehouse],
    ] as const) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    close();
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", gap: 10, alignItems: "center" }}>
      <button
        type="button"
        onClick={isOpen ? close : openPanel}
        onMouseEnter={filtersHover.on}
        onMouseLeave={filtersHover.off}
        aria-expanded={isOpen}
        style={{
          height: 38,
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: filtersHover.value ? COLORS.bgApp : "#fff",
          border: `1px solid ${activeCount > 0 ? COLORS.teal : COLORS.borderStrong}`,
          borderRadius: 8,
          fontSize: 13.5,
          fontWeight: 600,
          color: activeCount > 0 ? COLORS.tealDark : COLORS.text,
          cursor: "pointer",
        }}
      >
        <Funnel size={14} strokeWidth={1.6} />
        Filters
        {activeCount > 0 && (
          <span
            style={{
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: COLORS.teal,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {activeCount}
          </span>
        )}
      </button>

      <div style={{ position: "relative", width: 200 }}>
        <input
          readOnly
          placeholder="Select date"
          value={rangeLabel(appliedFrom, appliedTo)}
          onClick={isOpen ? close : openPanel}
          style={{
            width: "100%",
            height: 38,
            border: `1px solid ${isOpen ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 8,
            padding: "0 38px 0 12px",
            fontSize: 13.5,
            outline: "none",
            cursor: "pointer",
            boxShadow: isOpen ? `0 0 0 3px ${COLORS.focusRing}` : "none",
            textOverflow: "ellipsis",
          }}
        />
        <Calendar
          size={15}
          strokeWidth={1.6}
          color={COLORS.slateMid}
          style={{ position: "absolute", right: 12, top: 11, pointerEvents: "none" }}
        />
      </div>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 46,
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

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={labelStyle}>Warehouse</span>
            <div style={{ position: "relative" }}>
              <select
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                style={{ ...fieldStyle, appearance: "none", padding: "0 32px 0 12px", cursor: "pointer" }}
              >
                <option value="">All warehouses</option>
                {warehouses.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                strokeWidth={1.8}
                color={COLORS.slateMid}
                style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none" }}
              />
            </div>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              onClick={() => apply({ from: "", to: "", warehouse: "" })}
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
              Reset
            </button>
            <button
              type="button"
              onClick={() => apply({ from, to, warehouse })}
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
