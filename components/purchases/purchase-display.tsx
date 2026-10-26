import type { PaymentStatus, PaymentType, PurchaseStatus, SaleReturnStatus, TransferStatus } from "@prisma/client";

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  RECEIVED: "Received",
  ORDERED: "Ordered",
  PENDING: "Pending",
};

// Document status of any purchase/sale/transfer document. Sale returns
// (Pending / Received / Completed) and transfers (Pending / Sent / Completed)
// use their own enums.
export type DocumentStatus = PurchaseStatus | SaleReturnStatus | TransferStatus;

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  ...PURCHASE_STATUS_LABELS,
  COMPLETED: "Completed",
  SENT: "Sent",
};

// Sale return status select options, in design order (create + edit).
export const SALE_RETURN_STATUS_OPTIONS = (["PENDING", "RECEIVED", "COMPLETED"] as const).map((value) => ({
  value,
  label: DOCUMENT_STATUS_LABELS[value],
}));

// Transfer status select options, in design order (Completed is the default).
export const TRANSFER_STATUS_OPTIONS = (["COMPLETED", "SENT", "PENDING"] as const).map((value) => ({
  value,
  label: DOCUMENT_STATUS_LABELS[value],
}));

// Whether a document in this status has moved stock (Received, or a sale
// return's Completed). Pending/Ordered never move stock.
export const movesStock = (status: DocumentStatus) => status === "RECEIVED" || status === "COMPLETED";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CARD: "Card",
  CHEQUE: "Cheque",
};

// Text that differs between documents (Purchase, Purchase Return, Sale) on
// the shared details page and PDF.
export type PurchaseDocumentCopy = {
  noun: string;
  title: string;
  overline: string;
  partyTitle: string;
  infoTitle: string;
  // Width of the label column in the info card (the Sale design uses 110px).
  infoLabelWidth: number;
  qtyLabel: string;
  // "Net unit cost" / "Net unit price", "Unit cost" / "Unit price".
  priceWord: "cost" | "price";
  basePath: string;
  // "Reference PU_… · received into Office". Without it the subtitle reads
  // "Reference SA_… · Office warehouse" (Sale design).
  statusPhrase?: Partial<Record<DocumentStatus, string>>;
  // PDF header label; defaults to the overline. Sales print as an invoice.
  pdfHeading?: string;
  // Sale returns: the money side is a refund to the customer — "Refund
  // summary", "Refunded", "Refund due", and no payment-type row.
  refunds?: boolean;
  // Transfers: no payment row, no Download PDF, a separate Unit column
  // (Qty | Unit) instead of "Unit cost", and the module's own pill colours.
  noPayment?: boolean;
  noPdf?: boolean;
  unitColumn?: boolean;
  statusPalette?: Partial<Record<DocumentStatus, [string, string, string]>>;
};

export const PURCHASE_COPY: PurchaseDocumentCopy = {
  noun: "Purchase",
  title: "Purchase Details",
  overline: "Purchase details",
  partyTitle: "Supplier info",
  infoTitle: "Purchase info",
  infoLabelWidth: 86,
  qtyLabel: "Quantity",
  priceWord: "cost",
  basePath: "/purchases",
  statusPhrase: { RECEIVED: "received into", ORDERED: "ordered for", PENDING: "pending for" },
};

export const PURCHASE_RETURN_COPY: PurchaseDocumentCopy = {
  noun: "Purchase Return",
  title: "Purchase Return Details",
  overline: "Purchase return details",
  partyTitle: "Supplier info",
  infoTitle: "Return info",
  infoLabelWidth: 86,
  qtyLabel: "Qty",
  priceWord: "cost",
  basePath: "/purchases/returns",
  statusPhrase: { RECEIVED: "returned from", ORDERED: "ordered from", PENDING: "pending from" },
};

export const SALE_COPY: PurchaseDocumentCopy = {
  noun: "Sale",
  title: "Sale Details",
  overline: "Sale details",
  partyTitle: "Customer info",
  infoTitle: "Invoice info",
  infoLabelWidth: 110,
  qtyLabel: "Quantity",
  priceWord: "price",
  basePath: "/sales",
  pdfHeading: "Invoice",
};

export const SALE_RETURN_COPY: PurchaseDocumentCopy = {
  noun: "Sale Return",
  title: "Sale Return Details",
  overline: "Sale return details",
  partyTitle: "Customer info",
  infoTitle: "Return info",
  infoLabelWidth: 110,
  qtyLabel: "Qty",
  priceWord: "price",
  basePath: "/sales/returns",
  statusPhrase: { PENDING: "pending return to", RECEIVED: "returned to", COMPLETED: "returned to" },
  pdfHeading: "Credit note",
  refunds: true,
};

// Pill colours from the RingzPOS designs: [background, text, dot].
const STATUS_COLORS: Record<DocumentStatus, [string, string, string]> = {
  RECEIVED: ["#e2f4ec", "#0b6146", "#10805c"],
  ORDERED: ["#e3eefb", "#17518c", "#1c62a8"],
  PENDING: ["#fdf1d8", "#7d5106", "#9a6407"],
  // From the RingzPOS design system's "Completed" pill.
  COMPLETED: ["#eff8f6", "#0a6355", "#0f7d6a"],
  SENT: ["#e3eefb", "#17518c", "#1c62a8"],
};

// Transfers (RingzPOS Transfers design): Completed in teal-green, Sent in the
// app's blue, Pending in amber.
export const TRANSFER_STATUS_COLORS: Partial<Record<DocumentStatus, [string, string, string]>> = {
  COMPLETED: ["#e2f4ec", "#0b6146", "#10805c"],
  SENT: ["#e3eefb", "#17518c", "#1c62a8"],
  PENDING: ["#fdf1d8", "#7d5106", "#9a6407"],
};

export const TRANSFER_COPY: PurchaseDocumentCopy = {
  noun: "Transfer",
  title: "Transfer Details",
  overline: "Transfer details",
  partyTitle: "From warehouse",
  infoTitle: "Transfer info",
  infoLabelWidth: 86,
  qtyLabel: "Qty",
  priceWord: "cost",
  basePath: "/transfers",
  noPayment: true,
  noPdf: true,
  unitColumn: true,
  statusPalette: TRANSFER_STATUS_COLORS,
};

// `palette` overrides colours for a module whose design differs.
export function PurchaseStatusPill({
  status,
  palette,
}: {
  status: DocumentStatus;
  palette?: Partial<Record<DocumentStatus, [string, string, string]>>;
}) {
  const [background, color, dot] = palette?.[status] ?? STATUS_COLORS[status];

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
      {DOCUMENT_STATUS_LABELS[status]}
    </span>
  );
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: "Paid",
  PARTIAL: "Partial",
  UNPAID: "Unpaid",
};

// Paid uses the design's green-teal pill; Partial reuses the amber (Pending)
// pill and Unpaid the red pill from the RingzPOS design system.
const PAYMENT_STATUS_COLORS: Record<PaymentStatus, [string, string, string]> = {
  PAID: ["#e2f4ec", "#0b6146", "#10805c"],
  PARTIAL: ["#fdf1d8", "#7d5106", "#9a6407"],
  UNPAID: ["#fce8e6", "#93201a", "#b3261e"],
};

export function PaymentStatusPill({ paymentStatus }: { paymentStatus: PaymentStatus }) {
  const [background, color, dot] = PAYMENT_STATUS_COLORS[paymentStatus];

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
      {PAYMENT_STATUS_LABELS[paymentStatus]}
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
