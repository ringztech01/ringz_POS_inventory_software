"use client";

import { useEffect } from "react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

function CancelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const hover = useToggleState();
  const isHovered = hover.value && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 38,
        padding: "0 18px",
        background: isHovered ? COLORS.bgApp : "#fff",
        border: `1px solid ${COLORS.borderStrong}`,
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: COLORS.text,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .12s",
      }}
    >
      Cancel
    </button>
  );
}

function ConfirmButton({
  onClick,
  pending,
  label,
  pendingLabel,
  tone,
}: {
  onClick: () => void;
  pending?: boolean;
  label: string;
  pendingLabel: string;
  tone: "danger" | "primary";
}) {
  const hover = useToggleState();
  const isHovered = hover.value && !pending;
  const baseColor = tone === "danger" ? COLORS.danger : COLORS.teal;
  const hoverColor = tone === "danger" ? "#9a1f19" : COLORS.tealDark;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 38,
        padding: "0 20px",
        background: pending ? COLORS.slateLight : isHovered ? hoverColor : baseColor,
        border: "none",
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: "#fff",
        cursor: pending ? "not-allowed" : "pointer",
        transition: "background .12s",
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function ConfirmDeleteModal({
  title,
  message,
  onCancel,
  onConfirm,
  pending,
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  tone = "danger",
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  confirmLabel?: string;
  pendingLabel?: string;
  tone?: "danger" | "primary";
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(7,27,24,.44)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        animation: "elv-fade .12s ease-out",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 440,
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 20px 48px -12px rgba(23,27,28,.34)",
          overflow: "hidden",
          animation: "elv-pop .16s ease-out",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <h4 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>{title}</h4>
        </div>

        <div style={{ padding: 24 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid, lineHeight: 1.5 }}>{message}</p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            padding: "18px 24px",
            borderTop: `1px solid ${COLORS.border}`,
            background: COLORS.bgInput,
          }}
        >
          <CancelButton onClick={onCancel} disabled={pending} />
          <ConfirmButton onClick={onConfirm} pending={pending} label={confirmLabel} pendingLabel={pendingLabel} tone={tone} />
        </div>
      </div>
    </div>
  );
}
