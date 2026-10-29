import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PurchaseDocumentRow } from "@/components/purchases/PurchaseTable";
import {
  dateRangeWhere,
  toDocumentForEdit,
  toPurchaseDocument,
  type DocumentForEdit,
  type PurchaseDocument,
  type PurchaseListParams,
} from "../purchases/queries";

// Also read by the dashboard's Recent Sales.
export const SALE_LIST_SELECT = {
  id: true,
  reference: true,
  date: true,
  status: true,
  paymentType: true,
  paymentStatus: true,
  grandTotal: true,
  paid: true,
  due: true,
  createdAt: true,
  customer: { select: { name: true } },
  warehouse: { select: { name: true } },
} satisfies Prisma.SaleSelect;

// The list's filter (search, warehouse, date range; active rows only) —
// shared with the dashboard (lib/dashboard/queries.ts), which adds only
// its status rule, so the two always agree on the rest.
export function saleListWhere({ q, from, to, warehouseId }: Omit<PurchaseListParams, "page" | "perPage">): Prisma.SaleWhereInput {
  return {
    deletedAt: null,
    ...(warehouseId ? { warehouseId } : {}),
    ...dateRangeWhere(from, to),
    ...(q
      ? {
          OR: [{ reference: { contains: q } }, { customer: { name: { contains: q } } }],
        }
      : {}),
  };
}

export async function getSaleList({ q, from, to, warehouseId, page = 1, perPage = 10 }: PurchaseListParams) {
  const where = saleListWhere({ q, from, to, warehouseId });

  const [aggregate, rows] = await Promise.all([
    prisma.sale.aggregate({ where, _count: { _all: true }, _sum: { grandTotal: true, paid: true } }),
    prisma.sale.findMany({
      where,
      select: SALE_LIST_SELECT,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // Decimal → string at the query boundary (rows reach client components).
  const sales: PurchaseDocumentRow[] = rows.map(({ customer, ...row }) => ({
    ...row,
    grandTotal: row.grandTotal.toString(),
    paid: row.paid.toString(),
    due: row.due.toString(),
    party: customer,
  }));

  return {
    sales,
    total: aggregate._count._all,
    // Sums over every sale matching the filter, not just the current page.
    totals: {
      grandTotal: (aggregate._sum.grandTotal ?? 0).toString(),
      paid: (aggregate._sum.paid ?? 0).toString(),
    },
  };
}

// Customer select options. The protected walk-in customer (isDefault, the
// design's "direct-customer") comes first and is the form's default.
export async function getActiveCustomers() {
  return prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

// Details page + invoice PDF data. Null for missing or soft-deleted sales.
// Sale lines are mapped onto the shared document shape (netUnitPrice →
// unit price column, saleUnit → unit), and the active payments are included.
export async function getSaleDocument(id: string): Promise<PurchaseDocument | null> {
  const sale = await prisma.sale.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { name: true, email: true, phoneNumber: true, address: true, city: true, country: true } },
      warehouse: { select: { name: true } },
      items: { include: { product: { select: { name: true, code: true } } }, orderBy: { id: "asc" } },
      payments: {
        where: { deletedAt: null },
        select: { id: true, date: true, amount: true, paymentType: true, notes: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!sale) return null;

  return {
    ...toPurchaseDocument({
      ...sale,
      party: sale.customer,
      items: sale.items.map(({ netUnitPrice, saleUnit, ...item }) => ({
        ...item,
        netUnitCost: netUnitPrice,
        purchaseUnit: saleUnit,
      })),
    }),
    paid: sale.paid.toFixed(2),
    due: sale.due.toFixed(2),
    paymentStatus: sale.paymentStatus,
    payments: sale.payments.map((payment) => ({ ...payment, amount: payment.amount.toFixed(2) })),
  };
}

// Pre-fill for /sales/[id]/edit. Null for missing or soft-deleted sales. A
// Received sale's lines carry `reserved` (its own qty) so the form's stock
// cap is current stock + this sale's qty for that line.
export async function getSaleForEdit(id: string): Promise<DocumentForEdit | null> {
  const sale = await prisma.sale.findFirst({
    where: { id, deletedAt: null },
    include: {
      warehouse: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!sale) return null;

  return toDocumentForEdit(
    {
      ...sale,
      party: sale.customer,
      partyId: sale.customerId,
      items: sale.items.map(({ netUnitPrice, saleUnit, ...item }) => ({
        ...item,
        netUnitCost: netUnitPrice,
        purchaseUnit: saleUnit,
      })),
    },
    { reserveReceived: true },
  );
}
