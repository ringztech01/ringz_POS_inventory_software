"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

// "Warehouse :" — the report's warehouse filter (RingzPOS Reports design).
// Writes ?warehouse= (absent = All Warehouse) and resets the page.
export default function ReportWarehouseSelect({
  warehouses,
  value,
}: {
  warehouses: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focus = useToggleState();

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("warehouse", next);
    else params.delete("warehouse");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>Warehouse :</span>
      <div style={{ position: "relative", width: 520, maxWidth: "100%" }}>
        <select
          value={value}
          aria-label="Warehouse"
          onChange={(event) => change(event.target.value)}
          onFocus={focus.on}
          onBlur={focus.off}
          style={{
            appearance: "none",
            width: "100%",
            height: 48,
            border: `1px solid ${focus.value ? COLORS.teal : COLORS.borderStrong}`,
            borderRadius: 10,
            padding: "0 40px 0 16px",
            fontSize: 14.5,
            background: "#fff",
            cursor: "pointer",
            outline: "none",
            boxShadow: focus.value ? `0 0 0 3px ${COLORS.focusRing}` : "0 1px 2px rgba(23,27,28,.05)",
          }}
        >
          <option value="">All Warehouse</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          color={COLORS.slateMid}
          style={{ position: "absolute", right: 16, top: 16, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}
