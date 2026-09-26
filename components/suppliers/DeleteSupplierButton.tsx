"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import IconActionButton from "@/components/ui/IconActionButton";
import { deleteSupplier } from "@/app/(dashboard)/peoples/suppliers/actions";

function MiniButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const hover = useToggleState();
  const isHovered = hover.value && !disabled;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 30,
        padding: "0 12px",
        background: danger ? COLORS.danger : isHovered ? COLORS.bgApp : "#fff",
        border: danger ? "none" : `1px solid ${COLORS.borderStrong}`,
        borderRadius: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: danger ? "#fff" : COLORS.text,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function DeleteSupplierButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isConfirmOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeConfirm();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeConfirm();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isConfirmOpen, closeConfirm]);

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteSupplier(id);
      closeConfirm();

      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <IconActionButton
        icon={<Trash2 size={15} strokeWidth={1.8} />}
        title="Delete supplier"
        tone="danger"
        onClick={isConfirmOpen ? closeConfirm : openConfirm}
      />

      {isConfirmOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 38,
            width: 240,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 14,
            zIndex: 50,
            animation: "elv-pop .12s ease-out",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            textAlign: "left",
          }}
        >
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.text }}>Delete {name}?</p>
          <p style={{ margin: 0, fontSize: 12.5, color: COLORS.slateMid }}>
            This supplier will be removed from the list.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <MiniButton onClick={closeConfirm} disabled={isPending}>
              Cancel
            </MiniButton>
            <MiniButton onClick={handleConfirmDelete} disabled={isPending} danger>
              {isPending ? "Deleting…" : "Delete"}
            </MiniButton>
          </div>
        </div>
      )}
    </div>
  );
}
