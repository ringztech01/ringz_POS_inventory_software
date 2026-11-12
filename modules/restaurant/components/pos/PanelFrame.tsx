"use client";

import { useEffect, type ReactNode } from "react";
import { TOUCH } from "../../lib/theme";
import TouchButton from "./TouchButton";

// A panel's footer keys (the Restaurant POS design): 56 px, bold.
export const footerKey = { height: 56, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 16, fontWeight: 700, flexShrink: 0 } as const;
export const doneKey = { ...footerKey, padding: "0 36px", fontSize: 17 } as const;

// Cancel, bottom left of every panel.
export function CancelKey({ onCancel, label = "Cancel" }: { onCancel: () => void; label?: string }) {
  return (
    <TouchButton data-panel-cancel background={TOUCH.cancel} color={TOUCH.dangerText} onClick={onCancel} style={{ ...footerKey, padding: "0 22px" }}>
      {label}
    </TouchButton>
  );
}

// A touch-POS panel in the grid's place (the crumb bar stays above it): a
// title with its hint, the body, and the footer — Cancel on the left, the
// panel's own keys on the right. Esc cancels.
export default function PanelFrame({
  label,
  title,
  hint,
  children,
  footer,
  onCancel,
}: {
  label: string;
  title: ReactNode;
  // Beside the title, quieter: "Tap to add or remove".
  hint?: ReactNode;
  children: ReactNode;
  // Keys on the right of the footer.
  footer?: ReactNode;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-label={label} data-pos-panel style={panelStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: TOUCH.text, overflowWrap: "anywhere" }}>{title}</span>
        {hint && <span style={{ fontSize: 13, fontWeight: 600, color: TOUCH.textDim }}>{hint}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: TOUCH.gap }}>{children}</div>
      <div style={{ display: "flex", gap: TOUCH.gap, flexShrink: 0 }}>
        <CancelKey onCancel={onCancel} />
        <div style={{ flex: 1 }} />
        {footer}
      </div>
    </div>
  );
}

export const panelStyle = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  background: TOUCH.header,
  color: TOUCH.text,
  borderRadius: TOUCH.radius,
  zIndex: 5,
  minHeight: 0,
} as const;
