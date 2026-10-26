import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  dateRangeWhere,
  toDocumentForEdit,
  toPurchaseDocument,
  type DocumentForEdit,
  type PurchaseDocument,
} from "../purchases/queries";
import type { FormOption } from "../purchases/types";
import type { TransferRow } from "@/components/transfers/TransferTable";

export type TransferListParams = { q?: string; from?: string; to?: string; page?: number; perPage?: number };

export async function getTransferList({ q, from, to, page = 1, perPage = 10 }: TransferListParams) {
  const where: Prisma.TransferWhereInput = {
    deletedAt: null,
    ...dateRangeWhere(from, to),
    ...(q
      ? {
          OR: [
            { reference: { contains: q } },
            { fromWarehouse: { name: { contains: q } } },
            { toWarehouse: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.transfer.count({ where }),
    prisma.transfer.findMany({
      where,
      select: {
        id: true,
        reference: true,
        status: true,
        grandTotal: true,
        createdAt: true,
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // Decimal → string, and the created date formatted here: the rows go to a
  // client component, and formatting on the server keeps the browser's
  // timezone from changing the text (hydration mismatch).
  const transfers: TransferRow[] = rows.map((row) => {
    const created = formatDateTime(row.createdAt);
    return {
      id: row.id,
      reference: row.reference,
      fromName: row.fromWarehouse.name,
      toName: row.toWarehouse.name,
      items: row._count.items,
      grandTotal: row.grandTotal.toFixed(2),
      status: row.status,
      createdDate: created.date,
      createdTime: created.time,
    };
  });

  return { transfers, total };
}

const WAREHOUSE_CONTACT = { select: { name: true, email: true, phoneNumber: true, city: true, zipCode: true, country: true } } as const;

const warehouseAddress = (w: { city: string; zipCode: string; country: string }) =>
  [w.city, w.zipCode, w.country].filter(Boolean).join(", ");

// Details page data. Null for missing or soft-deleted transfers. Mapped onto
// the shared document shape: lines' transferUnit → the unit column, and the
// From/To warehouses as the two contact cards (no party, no payment).
export async function getTransferDocument(id: string): Promise<PurchaseDocument | null> {
  const transfer = await prisma.transfer.findFirst({
    where: { id, deletedAt: null },
    include: {
      fromWarehouse: WAREHOUSE_CONTACT,
      toWarehouse: WAREHOUSE_CONTACT,
      items: { include: { product: { select: { name: true, code: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!transfer) return null;

  const { fromWarehouse: from, toWarehouse: to } = transfer;
  return {
    ...toPurchaseDocument({
      ...transfer,
      paymentType: null,
      // Unused on screen (contactCards replace the party card).
      party: { ...from, address: "" },
      warehouse: from,
      items: transfer.items.map(({ transferUnit, ...item }) => ({ ...item, purchaseUnit: transferUnit })),
    }),
    contactCards: [
      { title: "From warehouse", ...from, address: warehouseAddress(from) },
      { title: "To warehouse", ...to, address: warehouseAddress(to) },
    ],
  };
}

// Pre-fill for /transfers/[id]/edit. Null for missing or soft-deleted
// transfers. Lines' stock is the current From stock PLUS this transfer's own
// qty when it is Completed (that qty already left From, and an edit may move
// it again) — shown and used as each line's cap.
export async function getTransferForEdit(
  id: string,
): Promise<(DocumentForEdit & { toWarehouse: FormOption }) | null> {
  const transfer = await prisma.transfer.findFirst({
    where: { id, deletedAt: null },
    include: {
      fromWarehouse: { select: { id: true, name: true } },
      toWarehouse: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { name: true, code: true, unit: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!transfer) return null;

  const document = await toDocumentForEdit(
    {
      ...transfer,
      warehouseId: transfer.fromWarehouseId,
      warehouse: transfer.fromWarehouse,
      partyId: "",
      party: { id: "", name: "" },
      items: transfer.items.map(({ transferUnit, ...item }) => ({ ...item, purchaseUnit: transferUnit })),
    },
    // Completed → each line carries its own qty as `reserved`.
    { reserveReceived: true },
  );

  return {
    ...document,
    initial: {
      ...document.initial,
      toWarehouseId: transfer.toWarehouseId,
      // Fold the reserved qty into the shown stock (the cap is stock then).
      lines: document.initial.lines.map(({ reserved = 0, ...line }) => ({ ...line, stock: line.stock + reserved, reserved: 0 })),
    },
    toWarehouse: transfer.toWarehouse,
  };
}
