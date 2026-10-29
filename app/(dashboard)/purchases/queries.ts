import type { DiscountType, PaymentStatus, PaymentType, Prisma, PurchaseStatus, SaleReturnStatus, TaxType, TransferStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeLine } from "@/lib/pricing";
import type { FormOption, PurchaseFormInitial } from "./types";

export type PurchaseListParams = {
  q?: string;
  // "YYYY-MM-DD", inclusive on both ends. Matched against the purchase date.
  from?: string;
  to?: string;
  warehouseId?: string;
  page?: number;
  perPage?: number;
};

const PURCHASE_LIST_SELECT = {
  id: true,
  reference: true,
  date: true,
  status: true,
  paymentType: true,
  grandTotal: true,
  createdAt: true,
  supplier: { select: { name: true } },
  warehouse: { select: { name: true } },
} satisfies Prisma.PurchaseSelect;

type PurchaseListPayload = Prisma.PurchaseGetPayload<{ select: typeof PURCHASE_LIST_SELECT }>;

// Decimal → string at the query boundary so rows are safe to hand to client
// components.
export type PurchaseListRow = Omit<PurchaseListPayload, "grandTotal"> & { grandTotal: string; party: { name: string } };

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

// Date-only values are stored anchored at UTC midnight (see formatDateForInput
// in lib/format.ts), so the filter boundaries are UTC midnights too.
export function parseDateParam(value: string | undefined): Date | null {
  if (!value || !DATE_PARAM.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// `{ date: … }` for an inclusive "YYYY-MM-DD" from/to range, or {} when
// neither end is valid. Shared by the purchase document lists.
export function dateRangeWhere(from?: string, to?: string): { date?: Prisma.DateTimeFilter } {
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to);
  if (!fromDate && !toDate) return {};
  return {
    date: {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lt: addDays(toDate, 1) } : {}),
    },
  };
}

// The list's filter (search, warehouse, date range; active rows only) —
// shared with the dashboard (lib/dashboard/queries.ts), which adds only
// its status rule, so the two always agree on the rest.
export function purchaseListWhere({ q, from, to, warehouseId }: Omit<PurchaseListParams, "page" | "perPage">): Prisma.PurchaseWhereInput {
  return {
    deletedAt: null,
    ...(warehouseId ? { warehouseId } : {}),
    ...dateRangeWhere(from, to),
    ...(q
      ? {
          OR: [{ reference: { contains: q } }, { supplier: { name: { contains: q } } }],
        }
      : {}),
  };
}

export async function getPurchaseList({ q, from, to, warehouseId, page = 1, perPage = 10 }: PurchaseListParams) {
  const where = purchaseListWhere({ q, from, to, warehouseId });

  const [aggregate, rows] = await Promise.all([
    prisma.purchase.aggregate({ where, _count: { _all: true }, _sum: { grandTotal: true } }),
    prisma.purchase.findMany({
      where,
      select: PURCHASE_LIST_SELECT,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const purchases: PurchaseListRow[] = rows.map((row) => ({
    ...row,
    grandTotal: row.grandTotal.toString(),
    party: row.supplier,
  }));

  return {
    purchases,
    total: aggregate._count._all,
    // Sum over every row matching the filter, not just the current page.
    grandTotalSum: (aggregate._sum.grandTotal ?? 0).toString(),
  };
}

export async function getActiveWarehouses() {
  return prisma.warehouse.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Everything the details page and the PDF show, as plain strings/numbers —
// for any purchase document (Purchase, Purchase Return). Both render from
// this one shape so they can't disagree. Money values are 2dp Decimal strings
// ("1250.00"); format them with formatNaira.
export type PurchaseDocument = {
  id: string;
  reference: string;
  date: Date;
  status: PurchaseStatus | SaleReturnStatus | TransferStatus;
  // Null for a sale with no payments yet.
  paymentType: PaymentType | null;
  notes: string | null;
  // Supplier (purchase documents) or customer (sales).
  party: { name: string; email: string; phoneNumber: string; address: string };
  warehouse: { name: string };
  // Transfers: the From and To warehouse cards, shown instead of the party
  // and company cards (and instead of the single Warehouse info row).
  contactCards?: { title: string; name: string; email: string; phoneNumber: string; address: string }[];
  items: {
    id: string;
    code: string;
    name: string;
    quantity: number;
    purchaseUnit: string;
    unitCost: string;
    netUnitCost: string;
    discount: string;
    tax: string;
    subtotal: string;
  }[];
  orderTaxRate: string;
  orderTaxAmount: string;
  discount: string;
  shipping: string;
  grandTotal: string;
  // Purchase Returns and Sales.
  paid?: string;
  due?: string;
  // Sale returns: the sale it returns from.
  // No href when that document has since been deleted.
  source?: { label: string; reference: string; href?: string };
  // Sales and Sale Returns (refunds).
  paymentStatus?: PaymentStatus;
  payments?: { id: string; date: Date; amount: string; paymentType: PaymentType; notes: string | null }[];
};

// The include both document queries use, so their records share a shape.
export const DOCUMENT_INCLUDE = {
  supplier: { select: { name: true, email: true, phoneNumber: true, address: true, city: true, country: true } },
  warehouse: { select: { name: true } },
  items: {
    include: { product: { select: { name: true, code: true } } },
    orderBy: { id: "asc" },
  },
} as const;

// The columns toPurchaseDocument needs from a Purchase, PurchaseReturn or
// Sale record. Callers pass the supplier/customer as `party`; sale lines map
// netUnitPrice/saleUnit onto netUnitCost/purchaseUnit.
export type DocumentRecordLike = {
  id: string;
  reference: string;
  date: Date;
  status: PurchaseStatus | SaleReturnStatus | TransferStatus;
  paymentType: PaymentType | null;
  notes: string | null;
  orderTax: Prisma.Decimal;
  orderTaxAmount: Prisma.Decimal;
  discount: Prisma.Decimal;
  shipping: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  party: { name: string; email: string; phoneNumber: string; address: string; city: string; country: string };
  warehouse: { name: string };
  items: {
    id: string;
    quantity: number;
    purchaseUnit: string;
    netUnitCost: Prisma.Decimal;
    discountType: DiscountType;
    discount: Prisma.Decimal;
    taxType: TaxType;
    orderTax: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    product: { name: string; code: string };
  }[];
};

// Maps a purchase document or sale record to PurchaseDocument.
export function toPurchaseDocument(record: DocumentRecordLike): PurchaseDocument {
  const { party } = record;

  return {
    id: record.id,
    reference: record.reference,
    date: record.date,
    status: record.status,
    paymentType: record.paymentType,
    notes: record.notes,
    party: {
      name: party.name,
      email: party.email,
      phoneNumber: party.phoneNumber,
      address: [party.address, party.city, party.country].filter(Boolean).join(", "),
    },
    warehouse: { name: record.warehouse.name },
    items: record.items.map((item) => {
      // Stored: the entered unit cost (netUnitCost column), discount/tax
      // inputs, and the server-computed taxAmount/subtotal. The per-unit net
      // cost and line discount are re-derived from the inputs with the same
      // lib/pricing.ts that produced the stored amounts.
      const priced = computeLine({
        unitCost: item.netUnitCost,
        quantity: item.quantity,
        discountType: item.discountType,
        discount: item.discount,
        taxType: item.taxType,
        taxRate: item.orderTax,
      });
      return {
        id: item.id,
        code: item.product.code,
        name: item.product.name,
        quantity: item.quantity,
        purchaseUnit: item.purchaseUnit,
        unitCost: item.netUnitCost.toFixed(2),
        netUnitCost: priced.netUnitCost.toFixed(2),
        discount: priced.discountAmount.toFixed(2),
        tax: item.taxAmount.toFixed(2),
        subtotal: item.subtotal.toFixed(2),
      };
    }),
    orderTaxRate: record.orderTax.toFixed(2),
    orderTaxAmount: record.orderTaxAmount.toFixed(2),
    discount: record.discount.toFixed(2),
    shipping: record.shipping.toFixed(2),
    grandTotal: record.grandTotal.toFixed(2),
  };
}

// Returns null for missing or soft-deleted purchases (callers notFound()).
export async function getPurchaseDocument(id: string): Promise<PurchaseDocument | null> {
  const purchase = await prisma.purchase.findFirst({
    where: { id, deletedAt: null },
    include: DOCUMENT_INCLUDE,
  });
  return purchase ? toPurchaseDocument({ ...purchase, party: purchase.supplier }) : null;
}

// Pre-fill values for the purchase document edit pages, in the same shape
// the form keeps in state (money as Decimal strings, zero amounts as "" so
// the "0.00" placeholder shows).
export const EDIT_INCLUDE = {
  warehouse: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  items: {
    include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
    orderBy: { id: "asc" },
  },
} as const;

export type DocumentForEdit = {
  id: string;
  reference: string;
  initial: PurchaseFormInitial;
  // The document's own warehouse/party (supplier or customer), so the selects
  // can still show them if they've since been soft-deleted (withCurrentOption).
  warehouse: FormOption;
  party: FormOption;
};

// The columns toDocumentForEdit needs. Callers pass the supplier/customer as
// party/partyId; sale lines map netUnitPrice/saleUnit onto
// netUnitCost/purchaseUnit.
export type EditRecordLike = {
  id: string;
  reference: string;
  date: Date;
  status: PurchaseStatus | SaleReturnStatus | TransferStatus;
  warehouseId: string;
  partyId: string;
  orderTax: Prisma.Decimal;
  discount: Prisma.Decimal;
  shipping: Prisma.Decimal;
  notes: string | null;
  warehouse: FormOption;
  party: FormOption;
  items: {
    productId: string;
    quantity: number;
    purchaseUnit: string;
    netUnitCost: Prisma.Decimal;
    discountType: DiscountType;
    discount: Prisma.Decimal;
    taxType: TaxType;
    orderTax: Prisma.Decimal;
    product: { name: string; code: string; unit: { name: string } };
  }[];
};

// Shared by Purchases, Purchase Returns, Sales and Transfers.
//
// reserveReceived (returns, sales, transfers — outbound documents): a
// Received (or Completed transfer) one has already taken its quantities out
// of the warehouse, so editing it may go up
// to current stock + what it already took out. Each line's `reserved` carries
// that amount; the form caps quantity at stock + reserved. The server
// re-checks either way.
export async function toDocumentForEdit(
  record: EditRecordLike,
  { reserveReceived }: { reserveReceived: boolean },
): Promise<DocumentForEdit> {
  const stocks = await prisma.productStock.findMany({
    where: { warehouseId: record.warehouseId, productId: { in: record.items.map((item) => item.productId) } },
    select: { productId: true, quantity: true },
  });
  const stockByProduct = new Map(stocks.map((row) => [row.productId, row.quantity]));
  const blankIfZero = (value: Prisma.Decimal) => (value.isZero() ? "" : value.toFixed(2));
  const holdsStock = reserveReceived && (record.status === "RECEIVED" || record.status === "COMPLETED");

  return {
    id: record.id,
    reference: record.reference,
    warehouse: record.warehouse,
    party: record.party,
    initial: {
      // Date-only values are stored at UTC midnight.
      date: record.date.toISOString().slice(0, 10),
      warehouseId: record.warehouseId,
      partyId: record.partyId,
      status: record.status,
      orderTax: blankIfZero(record.orderTax),
      discount: blankIfZero(record.discount),
      shipping: blankIfZero(record.shipping),
      notes: record.notes ?? "",
      lines: record.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        code: item.product.code,
        unitName: item.product.unit.name,
        stock: stockByProduct.get(item.productId) ?? 0,
        ...(reserveReceived ? { reserved: holdsStock ? item.quantity : 0 } : {}),
        unitCost: item.netUnitCost.toFixed(2),
        quantity: item.quantity,
        discountType: item.discountType,
        discount: item.discount.toFixed(2),
        taxType: item.taxType,
        taxRate: item.orderTax.toFixed(2),
        purchaseUnit: item.purchaseUnit,
      })),
    },
  };
}

// Null for missing or soft-deleted purchases.
export async function getPurchaseForEdit(id: string): Promise<DocumentForEdit | null> {
  const purchase = await prisma.purchase.findFirst({ where: { id, deletedAt: null }, include: EDIT_INCLUDE });
  return purchase
    ? toDocumentForEdit({ ...purchase, party: purchase.supplier, partyId: purchase.supplierId }, { reserveReceived: false })
    : null;
}

// Keeps a document's own warehouse/supplier selectable even if it has since
// been soft-deleted (it's then missing from the active list).
export function withCurrentOption(options: FormOption[], current: FormOption): FormOption[] {
  return options.some((option) => option.id === current.id) ? options : [...options, current];
}

export async function getActiveSuppliers() {
  return prisma.supplier.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
