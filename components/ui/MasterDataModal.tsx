"use client";

import { useEffect, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";

function CloseButton({ onClick }: { onClick: () => void }) {
  const hover = useToggleState();

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      title="Close"
      style={{
        width: 30,
        height: 30,
        border: "none",
        background: hover.value ? COLORS.bgApp : "transparent",
        borderRadius: 6,
        cursor: "pointer",
        color: hover.value ? COLORS.ink : COLORS.slateMid,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .12s",
      }}
    >
      <X size={15} strokeWidth={1.8} />
    </button>
  );
}

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

function SaveButton({ submitting }: { submitting?: boolean }) {
  const hover = useToggleState();
  const isHovered = hover.value && !submitting;

  return (
    <button
      type="submit"
      disabled={submitting}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 38,
        padding: "0 20px",
        background: submitting ? COLORS.slateLight : isHovered ? COLORS.tealDark : COLORS.teal,
        border: "none",
        borderRadius: 8,
        fontSize: 13.5,
        fontWeight: 600,
        color: "#fff",
        cursor: submitting ? "not-allowed" : "pointer",
        transition: "background .12s",
      }}
    >
      {submitting ? "Saving…" : "Save"}
    </button>
  );
}

export default function MasterDataModal({
  title,
  onClose,
  onSubmit,
  submitting,
  width = 440,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting?: boolean;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
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
          width,
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
          <CloseButton onClick={onClose} />
        </div>

        <form onSubmit={onSubmit} noValidate>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>

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
            <CancelButton onClick={onClose} disabled={submitting} />
            <SaveButton submitting={submitting} />
          </div>
        </form>
      </div>
    </div>
  );
}
