import type { PaymentType, Prisma, PurchaseStatus } from "@prisma/client";
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
export type PurchaseListRow = Omit<PurchaseListPayload, "grandTotal"> & { grandTotal: string };

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

export async function getPurchaseList({ q, from, to, warehouseId, page = 1, perPage = 10 }: PurchaseListParams) {
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to);

  const where: Prisma.PurchaseWhereInput = {
    deletedAt: null,
    ...(warehouseId ? { warehouseId } : {}),
    ...(fromDate || toDate
      ? {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lt: addDays(toDate, 1) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [{ reference: { contains: q } }, { supplier: { name: { contains: q } } }],
        }
      : {}),
  };

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

  const purchases: PurchaseListRow[] = rows.map((row) => ({ ...row, grandTotal: row.grandTotal.toString() }));

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

// Everything the details page and the PDF show, as plain strings/numbers.
// Both render from this one function so they can't disagree. Money values
// are 2dp Decimal strings ("1250.00"); format them with formatNaira.
export type PurchaseDocument = {
  id: string;
  reference: string;
  date: Date;
  status: PurchaseStatus;
  paymentType: PaymentType;
  notes: string | null;
  supplier: { name: string; email: string; phoneNumber: string; address: string };
  warehouse: { name: string };
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
};

// Returns null for missing or soft-deleted purchases (callers notFound()).
export async function getPurchaseDocument(id: string): Promise<PurchaseDocument | null> {
  const purchase = await prisma.purchase.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: { select: { name: true, email: true, phoneNumber: true, address: true, city: true, country: true } },
      warehouse: { select: { name: true } },
      items: {
        include: { product: { select: { name: true, code: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!purchase) return null;

  const { supplier } = purchase;

  return {
    id: purchase.id,
    reference: purchase.reference,
    date: purchase.date,
    status: purchase.status,
    paymentType: purchase.paymentType,
    notes: purchase.notes,
    supplier: {
      name: supplier.name,
      email: supplier.email,
      phoneNumber: supplier.phoneNumber,
      address: [supplier.address, supplier.city, supplier.country].filter(Boolean).join(", "),
    },
    warehouse: { name: purchase.warehouse.name },
    items: purchase.items.map((item) => {
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
    orderTaxRate: purchase.orderTax.toFixed(2),
    orderTaxAmount: purchase.orderTaxAmount.toFixed(2),
    discount: purchase.discount.toFixed(2),
    shipping: purchase.shipping.toFixed(2),
    grandTotal: purchase.grandTotal.toFixed(2),
  };
}

// Pre-fill values for /purchases/[id]/edit, in the same shape the form keeps
// in state (money as Decimal strings, zero amounts as "" so the "0.00"
// placeholder shows). Null for missing or soft-deleted purchases.
export async function getPurchaseForEdit(id: string): Promise<{
  id: string;
  reference: string;
  initial: PurchaseFormInitial;
  // The purchase's own warehouse/supplier, so the selects can still show them
  // if they've since been soft-deleted.
  warehouse: FormOption;
  supplier: FormOption;
} | null> {
  const purchase = await prisma.purchase.findFirst({
    where: { id, deletedAt: null },
    include: {
      warehouse: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!purchase) return null;

  const stocks = await prisma.productStock.findMany({
    where: { warehouseId: purchase.warehouseId, productId: { in: purchase.items.map((item) => item.productId) } },
    select: { productId: true, quantity: true },
  });
  const stockByProduct = new Map(stocks.map((row) => [row.productId, row.quantity]));
  const blankIfZero = (value: Prisma.Decimal) => (value.isZero() ? "" : value.toFixed(2));

  return {
    id: purchase.id,
    reference: purchase.reference,
    warehouse: purchase.warehouse,
    supplier: purchase.supplier,
    initial: {
      // Date-only values are stored at UTC midnight.
      date: purchase.date.toISOString().slice(0, 10),
      warehouseId: purchase.warehouseId,
      supplierId: purchase.supplierId,
      status: purchase.status,
      orderTax: blankIfZero(purchase.orderTax),
      discount: blankIfZero(purchase.discount),
      shipping: blankIfZero(purchase.shipping),
      notes: purchase.notes ?? "",
      lines: purchase.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        code: item.product.code,
        unitName: item.product.unit.name,
        stock: stockByProduct.get(item.productId) ?? 0,
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

export async function getActiveSuppliers() {
  return prisma.supplier.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
