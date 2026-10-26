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
} from "../../purchases/queries";
import type { PurchaseLine } from "../../purchases/types";
import { returnedBySaleItem } from "./returnable";

const SALE_RETURN_LIST_SELECT = {
  id: true,
  reference: true,
  date: true,
  status: true,
  paymentStatus: true,
  grandTotal: true,
  paid: true,
  createdAt: true,
  customer: { select: { name: true } },
  warehouse: { select: { name: true } },
} satisfies Prisma.SaleReturnSelect;

export async function getSaleReturnList({ q, from, to, warehouseId, page = 1, perPage = 10 }: PurchaseListParams) {
  const where: Prisma.SaleReturnWhereInput = {
    deletedAt: null,
    ...(warehouseId ? { warehouseId } : {}),
    ...dateRangeWhere(from, to),
    ...(q
      ? {
          OR: [
            { reference: { contains: q } },
            { customer: { name: { contains: q } } },
            // The original sale's SA_ reference.
            { sale: { reference: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.saleReturn.count({ where }),
    prisma.saleReturn.findMany({
      where,
      select: SALE_RETURN_LIST_SELECT,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // Decimal → string at the query boundary (rows reach client components).
  // paid / paymentStatus here are the refund to the customer.
  const saleReturns: PurchaseDocumentRow[] = rows.map(({ customer, ...row }) => ({
    ...row,
    grandTotal: row.grandTotal.toString(),
    paid: row.paid.toString(),
    paymentType: null,
    party: customer,
  }));

  return { saleReturns, total };
}

// Everything the create form needs from the original sale: its header (shown
// read-only) and one pre-filled line per sale line that still has something
// returnable, with qty = returnable and the sale line's price/discount/tax.
// Null for a missing or soft-deleted sale.
export async function getSaleForReturn(saleId: string): Promise<{
  sale: { id: string; reference: string; customerId: string; customerName: string; warehouseId: string; warehouseName: string };
  lines: PurchaseLine[];
} | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, deletedAt: null },
    include: {
      customer: { select: { name: true } },
      warehouse: { select: { name: true } },
      items: {
        include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!sale) return null;

  const [returned, stocks] = await Promise.all([
    returnedBySaleItem(prisma, sale.id),
    prisma.productStock.findMany({
      where: { warehouseId: sale.warehouseId, productId: { in: sale.items.map((item) => item.productId) } },
      select: { productId: true, quantity: true },
    }),
  ]);
  const stockByProduct = new Map(stocks.map((row) => [row.productId, row.quantity]));

  const lines: PurchaseLine[] = sale.items
    .map((item) => ({ item, returnable: item.quantity - (returned.get(item.id) ?? 0) }))
    .filter(({ returnable }) => returnable > 0)
    .map(({ item, returnable }) => ({
      productId: item.productId,
      saleItemId: item.id,
      name: item.product.name,
      code: item.product.code,
      unitName: item.product.unit.name,
      stock: stockByProduct.get(item.productId) ?? 0,
      maxQuantity: returnable,
      quantity: returnable,
      // The sale line's own price, discount and tax (editable in the modal).
      unitCost: item.netUnitPrice.toFixed(2),
      discountType: item.discountType,
      discount: item.discount.toFixed(2),
      taxType: item.taxType,
      taxRate: item.orderTax.toFixed(2),
      purchaseUnit: item.saleUnit,
    }));

  return {
    sale: {
      id: sale.id,
      reference: sale.reference,
      customerId: sale.customerId,
      customerName: sale.customer.name,
      warehouseId: sale.warehouseId,
      warehouseName: sale.warehouse.name,
    },
    lines,
  };
}

// Details page + credit-note PDF data. Null for missing or soft-deleted
// returns. Lines map onto the shared document shape (netUnitPrice → unit
// price column, saleUnit → unit); paid / due / paymentStatus and `payments`
// are the refunds to the customer. No payment type is stored on a return.
export async function getSaleReturnDocument(id: string): Promise<PurchaseDocument | null> {
  const saleReturn = await prisma.saleReturn.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { name: true, email: true, phoneNumber: true, address: true, city: true, country: true } },
      warehouse: { select: { name: true } },
      sale: { select: { id: true, reference: true, deletedAt: true } },
      items: { include: { product: { select: { name: true, code: true } } }, orderBy: { id: "asc" } },
      payments: {
        where: { deletedAt: null },
        select: { id: true, date: true, amount: true, paymentType: true, notes: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!saleReturn) return null;

  const { sale } = saleReturn;
  return {
    ...toPurchaseDocument({
      ...saleReturn,
      paymentType: null,
      party: saleReturn.customer,
      items: saleReturn.items.map(({ netUnitPrice, saleUnit, ...item }) => ({
        ...item,
        netUnitCost: netUnitPrice,
        purchaseUnit: saleUnit,
      })),
    }),
    // A soft-deleted sale's page 404s, so its reference isn't a link then.
    source: sale ? { label: "Sale", reference: sale.reference, href: sale.deletedAt ? undefined : `/sales/${sale.id}` } : undefined,
    paid: saleReturn.paid.toFixed(2),
    due: saleReturn.due.toFixed(2),
    paymentStatus: saleReturn.paymentStatus,
    payments: saleReturn.payments.map((payment) => ({ ...payment, amount: payment.amount.toFixed(2) })),
  };
}

// Pre-fill for /sales/returns/[id]/edit: the return's own lines, each capped
// at what the sale still has returnable once THIS return is left out
// (sold − other active returns). Null for missing or soft-deleted returns,
// or one with no live sale.
export async function getSaleReturnForEdit(id: string): Promise<
  | (DocumentForEdit & { sale: { id: string; reference: string; customerName: string; warehouseName: string } })
  | null
> {
  const saleReturn = await prisma.saleReturn.findFirst({
    where: { id, deletedAt: null, sale: { deletedAt: null } },
    include: {
      warehouse: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      sale: { select: { id: true, reference: true, items: { select: { id: true, quantity: true } } } },
      items: {
        include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!saleReturn?.sale) return null;
  const { sale } = saleReturn;

  const [document, returnedByOthers] = await Promise.all([
    toDocumentForEdit(
      {
        ...saleReturn,
        party: saleReturn.customer,
        partyId: saleReturn.customerId,
        items: saleReturn.items.map(({ netUnitPrice, saleUnit, ...item }) => ({
          ...item,
          netUnitCost: netUnitPrice,
          purchaseUnit: saleUnit,
        })),
      },
      { reserveReceived: false },
    ),
    returnedBySaleItem(prisma, sale.id, saleReturn.id),
  ]);
  const soldBySaleItem = new Map(sale.items.map((item) => [item.id, item.quantity]));

  return {
    ...document,
    initial: {
      ...document.initial,
      // Lines come back in the same order as saleReturn.items.
      lines: document.initial.lines.map((line, index) => {
        const { saleItemId } = saleReturn.items[index];
        return {
          ...line,
          saleItemId,
          maxQuantity: Math.max((soldBySaleItem.get(saleItemId) ?? 0) - (returnedByOthers.get(saleItemId) ?? 0), 0),
        };
      }),
    },
    sale: {
      id: sale.id,
      reference: sale.reference,
      customerName: saleReturn.customer.name,
      warehouseName: saleReturn.warehouse.name,
    },
  };
}
