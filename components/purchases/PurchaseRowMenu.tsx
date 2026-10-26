"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CircleDollarSign, Eye, FileText, MoreHorizontal, Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import SalePaymentsModal from "@/components/sales/SalePaymentsModal";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";

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
  disabled,
  icon,
  children,
}: {
  href?: string;
  download?: boolean;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  const hover = useToggleState();
  const style: CSSProperties = {
    ...menuItemStyle,
    color: disabled ? COLORS.slateLight : danger ? COLORS.danger : COLORS.text,
    background: hover.value && !disabled ? (danger ? COLORS.dangerBg : COLORS.bgApp) : "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
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
    <button type="button" style={style} onClick={onClick} disabled={disabled} {...hoverProps}>
      {icon}
      {children}
    </button>
  );
}

// Extra items a module adds between "Download PDF" and "Edit" (e.g. Sales:
// Show Payments, Create Sale Return). Icons are named, not passed as
// components, because the table that builds these is a server component.
const EXTRA_ICONS = { "circle-dollar-sign": CircleDollarSign, "shopping-cart": ShoppingCart } as const;

// Modals an extra item can open for the row's document (named for the same
// server→client reason as the icons).
const EXTRA_MODALS = { payments: SalePaymentsModal } as const;

export type RowMenuExtraItem = {
  label: string;
  icon: keyof typeof EXTRA_ICONS;
  href?: string;
  modal?: keyof typeof EXTRA_MODALS;
  // Shown greyed out (e.g. while its feature isn't built yet).
  disabled?: boolean;
};

// Row ⋯ menu for purchase documents (Purchases, Purchase Returns): View,
// Download PDF, Edit and Delete, all under `basePath`. The menu is absolutely
// positioned against the table row (which is position:relative), matching the
// design's right:16px / top:44px.
export default function PurchaseRowMenu({
  id,
  reference,
  basePath,
  noun,
  deleteMessage,
  deleteAction,
  extraItems = [],
}: {
  id: string;
  reference: string;
  // e.g. "/purchases" or "/purchases/returns"
  basePath: string;
  // e.g. "Purchase" or "Purchase Return" — used in labels and toasts.
  noun: string;
  deleteMessage: string;
  // Server action; the Delete item is disabled until a module provides one.
  deleteAction?: (id: string) => Promise<PurchaseActionState>;
  extraItems?: RowMenuExtraItem[];
}) {
  const router = useRouter();
  const { value: isOpen, on: open, off: close } = useToggleState();
  const { value: isConfirmOpen, on: openConfirm, off: closeConfirm } = useToggleState();
  const [isPending, startTransition] = useTransition();
  const [openModal, setOpenModal] = useState<keyof typeof EXTRA_MODALS | null>(null);
  const trigger = useToggleState();
  const containerRef = useRef<HTMLDivElement>(null);

  function handleConfirmDelete() {
    if (!deleteAction) return;
    startTransition(async () => {
      // The server re-checks the permission and re-reads the document.
      const result = await deleteAction(id);
      closeConfirm();

      if (result.ok) {
        toast.success(`${noun} ${reference} deleted.`);
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
          <MenuItem href={`${basePath}/${id}`} onClick={close} icon={<Eye {...iconProps} />}>
            View {noun}
          </MenuItem>
          <MenuItem href={`${basePath}/${id}/pdf`} download onClick={close} icon={<FileText {...iconProps} />}>
            Download PDF
          </MenuItem>
          {extraItems.map((item) => {
            const Icon = EXTRA_ICONS[item.icon];
            return (
              <MenuItem
                key={item.label}
                href={item.disabled ? undefined : item.href}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  if (item.modal && !item.disabled) setOpenModal(item.modal);
                }}
                icon={<Icon {...iconProps} />}
              >
                {item.label}
              </MenuItem>
            );
          })}
          <MenuItem href={`${basePath}/${id}/edit`} onClick={close} icon={<Pencil {...iconProps} />}>
            Edit {noun}
          </MenuItem>
          <div style={{ height: 1, background: COLORS.border, margin: "5px 6px" }} />
          <MenuItem
            danger
            disabled={!deleteAction}
            onClick={() => {
              close();
              openConfirm();
            }}
            icon={<Trash2 {...iconProps} />}
          >
            Delete {noun}
          </MenuItem>
        </div>
      )}

      {openModal &&
        (() => {
          const Modal = EXTRA_MODALS[openModal];
          return <Modal documentId={id} onClose={() => setOpenModal(null)} />;
        })()}

      {isConfirmOpen && (
        <ConfirmDeleteModal
          title={`Delete ${noun.toLowerCase()}`}
          message={deleteMessage}
          onCancel={closeConfirm}
          onConfirm={handleConfirmDelete}
          pending={isPending}
        />
      )}
    </div>
  );
}
