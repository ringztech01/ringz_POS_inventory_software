"use client";

import { Pencil, Trash2 } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import QtyInput from "@/components/ui/QtyInput";
import { formatNaira } from "@/lib/format";
import type { PurchaseLine } from "@/components/purchases/PurchaseForm";
import PosButton from "./PosButton";
import { POS } from "./theme";

export const CART_GRID = "minmax(0,1.7fr) 130px 100px 100px 40px";

const stepper = {
  width: 38,
  height: 38,
  borderRadius: 9,
  background: POS.indigoTint,
  color: POS.indigo,
  fontSize: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

// One cart line (RingzPOS POS.dc.html): name, code + edit, − qty +, unit
// price, subtotal (lib/pricing.ts, passed in), remove. `available` is the
// warehouse's stock: + stops there, and a line over it is flagged red (a hint
// only — the server checks at payment).
export default function PosCartRow({
  line,
  subtotal,
  available,
  onQuantity,
  onEdit,
  onRemove,
}: {
  line: PurchaseLine;
  // computeLine(line).subtotal, as a 2dp string.
  subtotal: string;
  available: number;
  onQuantity: (quantity: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const over = line.quantity > available;

  return (
    <div
      data-line={line.code}
      data-over={over || undefined}
      style={{
        display: "grid",
        gridTemplateColumns: CART_GRID,
        columnGap: 8,
        alignItems: "center",
        padding: "16px 0",
        borderBottom: `1px solid ${COLORS.bgApp}`,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
        <span
          title={line.name}
          style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {line.name}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              fontWeight: 600,
              background: POS.indigoTint,
              color: POS.indigo,
              padding: "3px 9px",
              borderRadius: 6,
            }}
          >
            {line.code}
          </span>
          <PosButton
            title="Edit item"
            aria-label={`Edit ${line.name}`}
            onClick={onEdit}
            style={{
              width: 24,
              height: 24,
              flex: "0 0 auto",
              background: "transparent",
              color: POS.indigo,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
            hoverStyle={{ color: POS.indigoHover }}
          >
            <Pencil size={14} strokeWidth={1.5} />
          </PosButton>
          {over && (
            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.danger, whiteSpace: "nowrap" }}>
              {available <= 0 ? "Out of stock" : `Only ${available} in stock`}
            </span>
          )}
        </span>
      </span>

      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <PosButton
          aria-label={`Decrease ${line.name}`}
          onClick={() => onQuantity(line.quantity - 1)}
          disabled={line.quantity <= 1}
          style={stepper}
          hoverStyle={{ background: POS.indigoTintHover }}
        >
          −
        </PosButton>
        <QtyInput plain value={line.quantity} onChange={onQuantity} ariaLabel={`Quantity of ${line.name}`} hasError={over} />
        <PosButton
          aria-label={`Increase ${line.name}`}
          title={line.quantity >= available ? `Only ${Math.max(available, 0)} in stock` : undefined}
          onClick={() => onQuantity(line.quantity + 1)}
          disabled={line.quantity >= available}
          style={stepper}
          hoverStyle={{ background: POS.indigoTintHover }}
        >
          +
        </PosButton>
      </span>

      <span style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.slate }}>{formatNaira(line.unitCost)}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600 }}>{formatNaira(subtotal)}</span>
      <PosButton
        title="Remove"
        aria-label={`Remove ${line.name}`}
        onClick={onRemove}
        style={{
          width: 36,
          height: 36,
          justifySelf: "center",
          background: "transparent",
          color: POS.remove,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
        hoverStyle={{ color: COLORS.danger }}
      >
        <Trash2 size={17} strokeWidth={1.5} />
      </PosButton>
    </div>
  );
}
