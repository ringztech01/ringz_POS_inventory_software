import type { PaymentType, PurchaseStatus } from "@prisma/client";

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  RECEIVED: "Received",
  ORDERED: "Ordered",
  PENDING: "Pending",
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  CHEQUE: "Cheque",
};

// Pill colours from the RingzPOS designs: [background, text, dot].
const STATUS_COLORS: Record<PurchaseStatus, [string, string, string]> = {
  RECEIVED: ["#e2f4ec", "#0b6146", "#10805c"],
  ORDERED: ["#e3eefb", "#17518c", "#1c62a8"],
  PENDING: ["#fdf1d8", "#7d5106", "#9a6407"],
};

export function PurchaseStatusPill({ status }: { status: PurchaseStatus }) {
  const [background, color, dot] = STATUS_COLORS[status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        padding: "5px 11px",
        borderRadius: 999,
        justifySelf: "start",
        background,
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      {PURCHASE_STATUS_LABELS[status]}
    </span>
  );
}

export function PaymentTypePill({ paymentType }: { paymentType: PaymentType }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 600,
        padding: "5px 11px",
        borderRadius: 999,
        justifySelf: "start",
        background: "#eff8f6",
        color: "#0a6355",
      }}
    >
      {PAYMENT_TYPE_LABELS[paymentType]}
    </span>
  );
}
