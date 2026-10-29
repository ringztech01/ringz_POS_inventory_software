"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import type { PosOption } from "@/app/(pos)/pos/types";
import type { HeldOrder } from "./held-orders";
import PosButton from "./PosButton";
import { POS } from "./theme";

const heldTime = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(
    new Date(iso),
  );

// The rose list tool: every held order with Resume / Discard. The total is
// computed with lib/pricing.ts, like the cart's.
export default function PosHeldOrdersModal({
  orders,
  customers,
  warehouses,
  onResume,
  onDiscard,
  onClose,
}: {
  orders: HeldOrder[];
  customers: PosOption[];
  warehouses: PosOption[];
  onResume: (order: HeldOrder) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}) {
  const [discarding, setDiscarding] = useState<HeldOrder | null>(null);
  const nameOf = (options: PosOption[], id: string, fallback: string) => options.find((o) => o.id === id)?.name ?? fallback;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !discarding) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, discarding]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(23,27,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "80px 16px",
      }}
    >
      <div
        role="dialog"
        aria-label="Orders on hold"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 640,
          maxHeight: "calc(100vh - 160px)",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 48px -12px rgba(23,27,28,.35)",
          animation: "elv-pop .12s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>
            Orders on hold <span style={{ color: COLORS.slateLight, fontWeight: 500 }}>({orders.length})</span>
          </h3>
          <PosButton
            title="Close"
            aria-label="Close"
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            hoverStyle={{ background: COLORS.bgApp, color: COLORS.ink }}
          >
            <X size={17} strokeWidth={1.8} />
          </PosButton>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 20px 16px" }}>
          {orders.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: COLORS.slateMid }}>No orders on hold.</div>
          ) : (
            orders.map((order, i) => {
              const total = computeOrder({
                itemsTotal: sumSubtotals(order.lines.map((line) => computeLine(line).subtotal)),
                taxRate: order.orderTax,
                discount: order.discount,
                shipping: order.shipping,
              }).grandTotal;
              const qty = order.lines.reduce((sum, line) => sum + line.quantity, 0);
              return (
                <div
                  key={order.id}
                  data-held={order.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 0",
                    borderBottom: i === orders.length - 1 ? "none" : `1px solid ${COLORS.bgApp}`,
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      flex: "0 0 auto",
                      borderRadius: 9,
                      background: POS.indigoTint,
                      color: POS.indigo,
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink }}>
                      {nameOf(customers, order.customerId, "Unknown customer")}
                      <span style={{ fontWeight: 500, color: COLORS.slateMid }}> · {nameOf(warehouses, order.warehouseId, "Unknown warehouse")}</span>
                    </span>
                    <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>
                      {order.lines.length} {order.lines.length === 1 ? "item" : "items"} · Qty {qty} · held {heldTime(order.heldAt)}
                    </span>
                  </span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{formatNaira(total.toFixed(2))}</span>
                  <PosButton
                    onClick={() => onResume(order)}
                    style={{ height: 38, padding: "0 16px", borderRadius: 9, background: POS.green, color: "#fff", fontSize: 13.5, fontWeight: 600 }}
                    hoverStyle={{ background: POS.greenHover }}
                  >
                    Resume
                  </PosButton>
                  <PosButton
                    onClick={() => setDiscarding(order)}
                    style={{ height: 38, padding: "0 14px", borderRadius: 9, background: COLORS.dangerBg, color: COLORS.danger, fontSize: 13.5, fontWeight: 600 }}
                    hoverStyle={{ background: "#f8d7d4" }}
                  >
                    Discard
                  </PosButton>
                </div>
              );
            })
          )}
        </div>
      </div>

      {discarding && (
        <div onClick={(event) => event.stopPropagation()}>
          <ConfirmDeleteModal
            title="Discard held order?"
            message={`The held order for ${nameOf(customers, discarding.customerId, "this customer")} (${discarding.lines.length} ${discarding.lines.length === 1 ? "item" : "items"}) will be removed. No sale was made, so no stock changes.`}
            confirmLabel="Discard"
            onCancel={() => setDiscarding(null)}
            onConfirm={() => {
              onDiscard(discarding.id);
              setDiscarding(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
