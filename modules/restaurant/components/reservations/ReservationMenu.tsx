"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { R } from "../../lib/theme";

const item = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  padding: "9px 10px",
  borderRadius: 6,
  fontSize: 13.5,
  color: COLORS.text,
  cursor: "pointer",
} as const;

// A Booked row's other actions (as the app's row menus): Cancel booking and
// Mark no-show. Each opens its confirmation in the panel.
export default function ReservationMenu({ onCancel, onNoShow }: { onCancel: () => void; onNoShow: () => void }) {
  const { value: isOpen, on: open, off: close } = useToggleState();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) close();
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

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        title="More actions"
        onClick={isOpen ? close : open}
        style={{
          width: 30,
          height: 30,
          border: `1px solid ${COLORS.borderStrong}`,
          background: "#fff",
          borderRadius: 7,
          cursor: "pointer",
          color: COLORS.slateMid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MoreHorizontal size={15} strokeWidth={1.8} />
      </button>
      {isOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: 34,
            zIndex: 20,
            width: 170,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 6,
            animation: "elv-pop .12s ease-out",
          }}
        >
          <button type="button" role="menuitem" style={item} onClick={() => { close(); onNoShow(); }}>
            Mark no-show
          </button>
          <div style={{ height: 1, background: COLORS.border, margin: "5px 6px" }} />
          <button type="button" role="menuitem" style={{ ...item, color: R.danger }} onClick={() => { close(); onCancel(); }}>
            Cancel booking
          </button>
        </div>
      )}
    </div>
  );
}
