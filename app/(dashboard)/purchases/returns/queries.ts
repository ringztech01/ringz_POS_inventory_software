import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PurchaseDocumentRow } from "@/components/purchases/PurchaseTable";
import {
  dateRangeWhere,
  DOCUMENT_INCLUDE,
  EDIT_INCLUDE,
  toDocumentForEdit,
  toPurchaseDocument,
  type DocumentForEdit,
  type PurchaseDocument,
  type PurchaseListParams,
} from "../queries";

const RETURN_LIST_SELECT = {
  id: true,
  reference: true,
  date: true,
  status: true,
  paymentType: true,
  grandTotal: true,
  paid: true,
  due: true,
  createdAt: true,
  supplier: { select: { name: true } },
  warehouse: { select: { name: true } },
} satisfies Prisma.PurchaseReturnSelect;

// The list's filter (search, warehouse, date range; active rows only) —
// shared with the dashboard (lib/dashboard/queries.ts), which adds only
// its status rule, so the two always agree on the rest.
export function purchaseReturnListWhere({ q, from, to, warehouseId }: Omit<PurchaseListParams, "page" | "perPage">): Prisma.PurchaseReturnWhereInput {
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

export async function getPurchaseReturnList({ q, from, to, warehouseId, page = 1, perPage = 10 }: PurchaseListParams) {
  const where = purchaseReturnListWhere({ q, from, to, warehouseId });

  const [total, rows] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      select: RETURN_LIST_SELECT,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // Decimal → string at the query boundary (rows reach client components).
  const returns: PurchaseDocumentRow[] = rows.map((row) => ({
    ...row,
    grandTotal: row.grandTotal.toString(),
    paid: row.paid.toString(),
    due: row.due.toString(),
    party: row.supplier,
  }));

  return { returns, total };
}

// Returns null for missing or soft-deleted returns (callers notFound()).
export async function getPurchaseReturnDocument(id: string): Promise<PurchaseDocument | null> {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({
    where: { id, deletedAt: null },
    include: DOCUMENT_INCLUDE,
  });
  if (!purchaseReturn) return null;

  return {
    ...toPurchaseDocument({ ...purchaseReturn, party: purchaseReturn.supplier }),
    paid: purchaseReturn.paid.toFixed(2),
    due: purchaseReturn.due.toFixed(2),
  };
}

// Pre-fill for /purchases/returns/[id]/edit. Null for missing or soft-deleted
// returns. Lines carry `reserved` (what a Received return already took out)
// so the form's quantity cap is stock + reserved.
export async function getPurchaseReturnForEdit(id: string): Promise<DocumentForEdit | null> {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({ where: { id, deletedAt: null }, include: EDIT_INCLUDE });
  return purchaseReturn
    ? toDocumentForEdit(
        { ...purchaseReturn, party: purchaseReturn.supplier, partyId: purchaseReturn.supplierId },
        { reserveReceived: true },
      )
    : null;
}
