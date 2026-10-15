"use client";

import { useEffect, useRef, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Eye, FileText, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { PurchaseStatus } from "@prisma/client";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { deletePurchase } from "@/app/(dashboard)/purchases/actions";

const menuItemStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  padding: "9px 10px",
  borderRadius: 6,
  fontSize: 13.5,
  color: COLORS.text,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 10,
  transition: "background .12s",
  textDecoration: "none",
};

function MenuItem({
  href,
  download,
  onClick,
  danger,
  icon,
  children,
}: {
  href?: string;
  download?: boolean;
  onClick?: () => void;
  danger?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  const hover = useToggleState();
  const style: CSSProperties = {
    ...menuItemStyle,
    color: danger ? COLORS.danger : COLORS.text,
    background: hover.value ? (danger ? COLORS.dangerBg : COLORS.bgApp) : "transparent",
  };
  const hoverProps = { onMouseEnter: hover.on, onMouseLeave: hover.off };

  if (href && download) {
    // Plain anchor: the PDF is a route handler response, not a page.
    return (
      <a href={href} style={style} onClick={onClick} {...hoverProps}>
        {icon}
        {children}
      </a>
    );
  }

  if (href) {
    return (
      <Link href={href} style={style} onClick={onClick} {...hoverProps}>
        {icon}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" style={style} onClick={onClick} {...hoverProps}>
      {icon}
      {children}
    </button>
  );
}

// The menu is absolutely positioned against the table row (which is
// position:relative), matching the design's right:16px / top:44px.
export default function PurchaseRowMenu({
  id,
  reference,
  status,
  warehouseName,
}: {
  id: string;
  reference: string;
  status: PurchaseStatus;
  warehouseName: string;
}) {
  const router = useRouter();
  const { value: isOpen, on: open, off: close } = useToggleState();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();
  const trigger = useToggleState();
  const containerRef = useRef<HTMLDivElement>(null);

  function handleConfirmDelete() {
    startTransition(async () => {
      // The server re-checks the permission and re-reads the purchase.
      const result = await deletePurchase(id);
      closeConfirm();

      if (result.ok) {
        toast.success(`Purchase ${reference} deleted.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
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

  const iconProps = { size: 15, strokeWidth: 1.7 };

  return (
    <div ref={containerRef} style={{ justifySelf: "end" }}>
      <button
        type="button"
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={isOpen ? close : open}
        onMouseEnter={trigger.on}
        onMouseLeave={trigger.off}
        style={{
          width: 30,
          height: 30,
          border: "none",
          background: trigger.value || isOpen ? COLORS.border : "transparent",
          borderRadius: 6,
          cursor: "pointer",
          color: trigger.value || isOpen ? COLORS.ink : COLORS.slateMid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .12s",
        }}
      >
        <MoreHorizontal size={16} strokeWidth={1.8} />
      </button>

      {isOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 16,
            top: 44,
            zIndex: 30,
            width: 200,
            background: "#fff",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            padding: 6,
            animation: "elv-pop .12s ease-out",
          }}
        >
          <MenuItem href={`/purchases/${id}`} onClick={close} icon={<Eye {...iconProps} />}>
            View Purchase
          </MenuItem>
          <MenuItem href={`/purchases/${id}/pdf`} download onClick={close} icon={<FileText {...iconProps} />}>
            Download PDF
          </MenuItem>
          <MenuItem href={`/purchases/${id}/edit`} onClick={close} icon={<Pencil {...iconProps} />}>
            Edit Purchase
          </MenuItem>
          <div style={{ height: 1, background: COLORS.border, margin: "5px 6px" }} />
          <MenuItem
            danger
            onClick={() => {
              close();
              openConfirm();
            }}
            icon={<Trash2 {...iconProps} />}
          >
            Delete Purchase
          </MenuItem>
        </div>
      )}

      {isConfirmOpen && (
        <ConfirmDeleteModal
          title="Delete purchase"
          message={
            status === "RECEIVED"
              ? `Are you sure you want to delete "${reference}"? This also removes the stock it added to ${warehouseName}.`
              : `Are you sure you want to delete "${reference}"? It hasn't added any stock, so stock levels won't change.`
          }
          onCancel={closeConfirm}
          onConfirm={handleConfirmDelete}
          pending={isPending}
        />
      )}
    </div>
  );
}
