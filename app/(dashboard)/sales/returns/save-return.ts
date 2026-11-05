import "server-only";
import { revalidatePath } from "next/cache";
import type { PaymentType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generateReference } from "@/lib/reference";
import { purchaseStockDeltas } from "@/lib/purchase-stock";
import { computePaymentState } from "@/lib/payments";
import { saleReturnSchema } from "@/lib/validations/sale-return";
import {
  applyStockDeltas,
  DocumentChangedError,
  documentItemsData,
  documentOrderData,
  invalid,
  isReferenceCollision,
  loadDocument,
  MAX_REFERENCE_ATTEMPTS,
  revalidateDocumentPaths,
  toFieldErrors,
  type Loaded,
} from "../../purchases/document-actions";
import type { PurchaseActionState } from "../../purchases/types";
import { lockSaleRow, returnedBySaleItem } from "./returnable";

export const LIST_PATH = "/sales/returns";

// Saving a new sale return — the path the Sales › Returns form takes (via
// createSaleReturn, Manage Sale Return) and the restaurant's refund of a
// settled bill (via saveSaleReturnInTx, in its own transaction). The caller
// checks the permission and passes the signed-in user.

// Thrown inside the transaction when a line would take back more than is
// still returnable on the sale (sold − already returned by active returns).
export class OverReturnError extends Error {
  constructor(
    public readonly quantity: number,
    public readonly productName: string,
    public readonly returnable: number,
    public readonly saleReference: string,
  ) {
    super("Return exceeds the returnable quantity.");
  }
}

export const overReturnMessage = (error: OverReturnError) =>
  `Can't return ${error.quantity} × ${error.productName} — only ${error.returnable} left returnable on ${error.saleReference}.`;

// Inside the transaction, AFTER lockSaleRow: every line must fit in
//   returnable = sold now − returned by the sale's other active returns.
// Sold quantities are re-read too (the sale may have been edited since the
// form loaded). `excludeReturnId`: on edit, the return's own old quantities
// are available again.
export async function assertReturnable(
  tx: Prisma.TransactionClient,
  sale: { id: string; reference: string },
  items: { saleItemId: string; productId: string; quantity: number }[],
  productById: Map<string, { name: string }>,
  excludeReturnId?: string,
) {
  const soldNow = new Map(
    (await tx.saleItem.findMany({ where: { saleId: sale.id }, select: { id: true, quantity: true } })).map(
      (item) => [item.id, item.quantity],
    ),
  );
  const returned = await returnedBySaleItem(tx, sale.id, excludeReturnId);
  for (const item of items) {
    const sold = soldNow.get(item.saleItemId);
    if (sold === undefined) throw new DocumentChangedError();
    const returnable = sold - (returned.get(item.saleItemId) ?? 0);
    if (item.quantity > returnable) {
      throw new OverReturnError(
        item.quantity,
        productById.get(item.productId)?.name ?? "this product",
        Math.max(returnable, 0),
        sale.reference,
      );
    }
  }
}

// The shared line rows use purchase column names; SaleReturnItem calls them
// netUnitPrice / saleUnit, and also links each row to its sale line.
export function saleReturnItemsData(lines: Pick<Loaded, "lines">["lines"], saleItemIds: string[]) {
  return documentItemsData(lines).map(({ netUnitCost, purchaseUnit, ...rest }, index) => ({
    ...rest,
    netUnitPrice: netUnitCost,
    saleUnit: purchaseUnit,
    saleItemId: saleItemIds[index],
  }));
}

export function revalidateSaleReturnPaths(saleId: string, productIds: string[], returnId?: string) {
  revalidateDocumentPaths(LIST_PATH, productIds, returnId);
  revalidatePath("/sales");
  revalidatePath(`/sales/${saleId}`);
}

// A refund paid with the return (the restaurant pays it back there and
// then; the Sales form records refunds later, from the return's page).
export type ReturnRefund = { amount: string; paymentType: PaymentType; date: Date; notes: string | null };

// Checks and prices a new return, without writing anything: saleReturnSchema,
// then the sale re-read — customer and warehouse come from it, every line
// must be one of its lines, each line's product is the sale line's — and
// lines and the grand total recomputed with lib/pricing.ts (loadDocument).
export async function prepareSaleReturn(input: unknown) {
  const parsed = saleReturnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, state: invalid(toFieldErrors(parsed.error)) };
  }

  // Re-read the sale server-side. Customer and warehouse come from it — the
  // form never sends them — and every line must be one of its lines.
  const sale = await prisma.sale.findFirst({
    where: { id: parsed.data.saleId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      customerId: true,
      warehouseId: true,
      items: { select: { id: true, productId: true, quantity: true } },
    },
  });
  if (!sale) {
    return { ok: false as const, state: { ok: false, error: "Sale not found. It may have been deleted." } as PurchaseActionState };
  }

  const saleItemById = new Map(sale.items.map((item) => [item.id, item]));
  if (parsed.data.items.some((item) => !saleItemById.has(item.saleItemId))) {
    return { ok: false as const, state: invalid({ items: [`One of the lines isn't on ${sale.reference}. Reload the page and try again.`] }) };
  }

  // Each line's product is the sale line's product, whatever the client sent.
  // The sale's warehouse/customer/products stay valid even if soft-deleted
  // since. Lines and the grand total are recomputed with lib/pricing.ts.
  const loaded = await loadDocument(
    {
      ...parsed.data,
      warehouseId: sale.warehouseId,
      items: parsed.data.items.map((item) => ({ ...item, productId: saleItemById.get(item.saleItemId)!.productId })),
    },
    sale.customerId,
    {
      party: "customer",
      existing: {
        warehouseId: sale.warehouseId,
        partyId: sale.customerId,
        productIds: sale.items.map((item) => item.productId),
      },
    },
  );
  if (loaded.kind === "invalid") return { ok: false as const, state: loaded.state };
  const { data, lines, order, productById } = loaded;
  return { ok: true as const, prepared: { sale: { id: sale.id, reference: sale.reference, customerId: sale.customerId, warehouseId: sale.warehouseId }, data, lines, order, productById } };
}

// A new sale return checked and priced, ready to be written.
export type PreparedSaleReturn = Extract<Awaited<ReturnType<typeof prepareSaleReturn>>, { ok: true }>["prepared"];

// Writes a prepared return inside the caller's transaction: lock the sale,
// re-check returnable, SR_ reference, the return + its lines (+ `refunds`
// paid with it; none from the Sales form: paid 0, due = grand total,
// Unpaid), and — with `moveStock`, only when Received or Completed — the
// stock increment for every line in the sale's warehouse (increaseStock
// upserts ProductStock). Pending moves no stock. (The restaurant returns a
// dish's ingredients itself.) Throws OverReturnError, DocumentChangedError
// or a reference collision for the caller to handle.
export async function writeSaleReturnInTx(
  tx: Prisma.TransactionClient,
  { sale, data, lines, order, productById }: PreparedSaleReturn,
  userId: string,
  { moveStock, refunds = [] }: { moveStock: boolean; refunds?: readonly ReturnRefund[] },
): Promise<{ id: string; reference: string }> {
  // Refund figures — derived, never typed in.
  const refundState = computePaymentState(order.grandTotal, [...refunds]);

  // First statement: serialises returns of this sale (and sale
  // edits/deletes), so the returnable check below sees every return
  // committed before us.
  if (!(await lockSaleRow(tx, sale.id))) throw new DocumentChangedError();

  await assertReturnable(tx, sale, data.items, productById);

  const saleReturn = await tx.saleReturn.create({
    data: {
      ...documentOrderData(data, order),
      saleId: sale.id,
      customerId: sale.customerId,
      reference: generateReference("SR"),
      paid: refundState.paid.toFixed(2),
      due: refundState.due.toFixed(2),
      paymentStatus: refundState.paymentStatus,
      createdById: userId,
      items: {
        create: saleReturnItemsData(
          lines,
          data.items.map((item) => item.saleItemId),
        ),
      },
      ...(refunds.length ? { payments: { create: refunds.map((refund) => ({ ...refund, createdById: userId })) } } : {}),
    },
    select: { id: true, reference: true },
  });

  if (moveStock) {
    // A return brings stock back IN (direction "in"); Received and
    // Completed both hold it (lib/purchase-stock.ts).
    const after = { status: data.status, warehouseId: sale.warehouseId, items: data.items };
    await applyStockDeltas(tx, purchaseStockDeltas(null, after, "in"), undefined);
  }
  return saleReturn;
}

export async function saveNewSaleReturn(input: unknown, userId: string): Promise<PurchaseActionState> {
  const ready = await prepareSaleReturn(input);
  if (!ready.ok) return ready.state;
  const { sale, data } = ready.prepared;

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.$transaction((tx) => writeSaleReturnInTx(tx, ready.prepared, userId, { moveStock: true }));

      revalidateSaleReturnPaths(
        sale.id,
        data.items.map((item) => item.productId),
      );
      return { ok: true, id: created.id, reference: created.reference };
    } catch (error) {
      if (error instanceof OverReturnError) return { ok: false, error: overReturnMessage(error) };
      if (error instanceof DocumentChangedError) {
        return { ok: false, error: "The sale was changed or deleted. Reload the page and try again." };
      }
      if (isReferenceCollision(error)) {
        if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
}

// A sale made by the Restaurant module's settle (Sale.order): its returns are
// made from the order — a dish's refund puts its ingredients back, which the
// Sales › Returns form can't do — so the form's new / edit / delete refuse
// it. Null for any other sale.
export async function restaurantSaleRefusal(saleId: string | null | undefined): Promise<string | null> {
  if (!saleId) return null;
  const order = await prisma.order.findFirst({ where: { saleId }, select: { number: true } });
  if (!order) return null;
  return `This sale is restaurant bill ORD-${String(order.number).padStart(4, "0")}. Its refunds are made from the order (Restaurant › Orders), so its dishes' stock goes back correctly.`;
}
