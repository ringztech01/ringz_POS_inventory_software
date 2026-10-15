"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { MoreVertical } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deleteAdjustment } from "@/app/(dashboard)/adjustments/actions";

const menuItemStyle = {
  display: "block",
  width: "100%",
  textAlign: "left" as const,
  background: "transparent",
  border: "none",
  padding: "9px 10px",
  borderRadius: 6,
  fontSize: 13.5,
  color: COLORS.text,
  cursor: "pointer",
  textDecoration: "none",
};

export default function AdjustmentRowMenu({ id, reference }: { id: string; reference: string }) {
  const router = useRouter();
  const { value: isOpen, on: open, off: close } = useToggleState();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

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

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteAdjustment(id);
      closeConfirm();

      if (result.ok) {
        toast.success("Adjustment deleted successfully.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div ref={containerRef} style={{ position: "relative", justifySelf: "end" }}>
      <button
        type="button"
        title="Actions"
        onClick={isOpen ? close : open}
        style={{
          width: 30,
          height: 30,
          border: "none",
          background: "transparent",
          borderRadius: 6,
          cursor: "pointer",
          color: COLORS.slateMid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MoreVertical size={16} strokeWidth={1.8} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 34,
            zIndex: 20,
            width: 186,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 6,
            animation: "elv-pop .12s ease-out",
          }}
        >
          <Link href={`/adjustments/${id}`} style={menuItemStyle} onClick={close}>
            View detail
          </Link>
          <div style={{ height: 1, background: COLORS.border, margin: "5px 6px" }} />
          <button
            type="button"
            style={{ ...menuItemStyle, color: COLORS.danger }}
            onClick={() => {
              close();
              openConfirm();
            }}
          >
            Delete
          </button>
        </div>
      )}

      {isConfirmOpen && (
        <ConfirmDeleteModal
          title="Delete adjustment"
          message={`Are you sure you want to delete "${reference}"? This reverses its stock effect and can't be undone from here.`}
          onCancel={closeConfirm}
          onConfirm={handleConfirmDelete}
          pending={isPending}
        />
      )}
    </div>
  );
}
