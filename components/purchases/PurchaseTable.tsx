import { ShoppingCart } from "lucide-react";
import type { PaymentStatus, PaymentType } from "@prisma/client";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";
import PurchaseRowMenu, { type RowMenuExtraItem } from "./PurchaseRowMenu";
import { movesStock, PaymentStatusPill, PaymentTypePill, PurchaseStatusPill, type DocumentStatus } from "./purchase-display";
import { formatDateTime, formatNaira } from "@/lib/format";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";

// A row of any purchase/sale document list (Purchases, Purchase Returns,
// Sales). Money is a Decimal string. `party` is the supplier or customer.
export type PurchaseDocumentRow = {
  id: string;
  reference: string;
  status: DocumentStatus;
  // Null for a sale with no payments yet.
  paymentType: PaymentType | null;
  paymentStatus?: PaymentStatus;
  grandTotal: string;
  paid?: string;
  due?: string;
  createdAt: Date;
  party: { name: string };
  warehouse: { name: string };
};

type ExtraColumn = "paid" | "due" | "paymentStatus";

// Grids from the RingzPOS designs, the columns each adds after Grand total,
// and whether it has a Payment type column (Sale Returns don't).
const LAYOUTS: Record<
  "purchase" | "purchaseReturn" | "sale" | "saleReturn",
  { columns: string; minWidth: number; extra: ExtraColumn[]; paymentType?: false }
> = {
  purchase: { columns: "130px minmax(150px,1fr) 120px 130px 150px 130px 150px 40px", minWidth: 1160, extra: [] },
  purchaseReturn: {
    columns: "130px minmax(140px,1fr) 110px 120px 140px 120px 120px 120px 150px 40px",
    minWidth: 1320,
    extra: ["paid", "due"],
  },
  sale: {
    columns: "130px minmax(150px,1fr) 110px 130px 140px 140px 140px 120px 150px 40px",
    minWidth: 1380,
    extra: ["paid", "paymentStatus"],
  },
  // The design's min-width is 1220px; the spec asks for 1440px.
  saleReturn: {
    columns: "130px minmax(150px,1fr) 110px 130px 140px 130px 140px 150px 40px",
    minWidth: 1440,
    extra: ["paid", "paymentStatus"],
    paymentType: false,
  },
};
const EXTRA_HEADERS: Record<ExtraColumn, string> = { paid: "Paid", due: "Due", paymentStatus: "Payment status" };
const RIGHT_ALIGNED = new Set(["Grand total", "Paid", "Due", "Action"]);

export default function PurchaseTable({
  rows,
  basePath,
  noun,
  layout = "purchase",
  partyLabel = "Supplier",
  stockEffect,
  movedStockLabel = "returned",
  deleteNote,
  totals,
  emptyMessage,
  deleteAction,
  rowExtraItems,
}: {
  rows: PurchaseDocumentRow[];
  basePath: string;
  noun: string;
  layout?: keyof typeof LAYOUTS;
  partyLabel?: string;
  // Which way a Received document moved stock: "in" (purchase) or "out"
  // (return, sale). Deleting it moves stock the other way; the confirm dialog
  // says so.
  stockEffect: "in" | "out";
  // "out" only: how the confirm dialog names that stock ("returned", "sold").
  movedStockLabel?: string;
  // Appended to every delete confirmation (e.g. Sales: payments go too).
  deleteNote?: string;
  // Footer "Total" row (sums over the whole filter, computed server-side).
  totals?: { grandTotal: string; paid?: string };
  emptyMessage: string;
  deleteAction?: (id: string) => Promise<PurchaseActionState>;
  // Extra ⋯ menu items for a row (between Download PDF and Edit).
  rowExtraItems?: (row: PurchaseDocumentRow) => RowMenuExtraItem[];
}) {
  if (rows.length === 0) {
    return <EmptyState icon={ShoppingCart} message={emptyMessage} />;
  }

  const grid = LAYOUTS[layout];
  const headers = [
    "Reference",
    partyLabel,
    "Warehouse",
    "Status",
    "Grand total",
    ...grid.extra.map((column) => EXTRA_HEADERS[column]),
    ...(grid.paymentType === false ? [] : ["Payment type"]),
    "Created on",
    "Action",
  ];
  const rowBase = {
    display: "grid",
    gridTemplateColumns: grid.columns,
    columnGap: 16,
    alignItems: "center",
    padding: "0 20px",
    whiteSpace: "nowrap",
  } as const;
  const money = { fontFamily: FONTS.mono, fontSize: 13, textAlign: "right" as const };

  function deleteMessage(row: PurchaseDocumentRow) {
    const question = `Are you sure you want to delete "${row.reference}"?`;
    const note = deleteNote ? ` ${deleteNote}` : "";
    if (!movesStock(row.status)) {
      return `${question} It hasn't moved any stock, so stock levels won't change.${note}`;
    }
    return stockEffect === "in"
      ? `${question} This also removes the stock it added to ${row.warehouse.name}.${note}`
      : `${question} This also adds the ${movedStockLabel} stock back to ${row.warehouse.name}.${note}`;
  }

  function extraCell(row: PurchaseDocumentRow, column: ExtraColumn) {
    if (column === "paymentStatus") {
      return row.paymentStatus ? <PaymentStatusPill key={column} paymentStatus={row.paymentStatus} /> : <span key={column} />;
    }
    return (
      <span key={column} style={{ ...money, color: COLORS.slate }}>
        {formatNaira(row[column] ?? "0")}
      </span>
    );
  }

  return (
    // The padding/negative-margin pair gives the row menus room to open below
    // the last rows without being clipped by the horizontal scroll container.
    <div style={{ overflowX: "auto", paddingBottom: 200, marginBottom: -200 }}>
      <div style={{ minWidth: grid.minWidth }}>
        <div
          style={{
            ...rowBase,
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          {headers.map((label) => (
            <span
              key={label}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: COLORS.slateMid,
                textAlign: RIGHT_ALIGNED.has(label) ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {rows.map((row) => {
          const createdOn = formatDateTime(row.createdAt);

          return (
            <div
              key={row.id}
              style={{
                ...rowBase,
                height: 60,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                position: "relative",
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  fontWeight: 500,
                  background: COLORS.bgApp,
                  border: `1px solid ${COLORS.borderStrong}`,
                  color: COLORS.text,
                  padding: "4px 9px",
                  borderRadius: 6,
                  justifySelf: "start",
                }}
              >
                {row.reference}
              </span>
              <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.party.name}
              </span>
              <span style={{ fontSize: 14, color: COLORS.slate, overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.warehouse.name}
              </span>
              <PurchaseStatusPill status={row.status} />
              <span style={{ ...money, fontWeight: 600 }}>{formatNaira(row.grandTotal)}</span>
              {grid.extra.map((column) => extraCell(row, column))}
              {grid.paymentType !== false &&
                (row.paymentType ? (
                  <PaymentTypePill paymentType={row.paymentType} />
                ) : (
                  <span style={{ fontSize: 13, color: COLORS.slateLight }}>—</span>
                ))}
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{createdOn.date}</span>
                <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{createdOn.time}</span>
              </span>
              <PurchaseRowMenu
                id={row.id}
                reference={row.reference}
                basePath={basePath}
                noun={noun}
                deleteMessage={deleteMessage(row)}
                deleteAction={deleteAction}
                extraItems={rowExtraItems?.(row)}
              />
            </div>
          );
        })}

        {totals && (
          <div
            style={{
              ...rowBase,
              height: 56,
              background: COLORS.bgInput,
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            {headers.map((label) =>
              label === "Reference" ? (
                <span key={label} style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink }}>
                  Total
                </span>
              ) : label === "Grand total" ? (
                <span key={label} style={{ ...money, fontWeight: 600 }}>
                  {formatNaira(totals.grandTotal)}
                </span>
              ) : label === "Paid" && totals.paid !== undefined ? (
                <span key={label} style={{ ...money, fontWeight: 600 }}>
                  {formatNaira(totals.paid)}
                </span>
              ) : (
                <span key={label} />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
