import "server-only";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { todayInAppZone } from "@/lib/dateRanges";
import { formatNaira } from "@/lib/format";
import { sumSubtotals } from "@/lib/pricing";
import { increaseStock } from "@/lib/stock";
import { DocumentChangedError, isReferenceCollision, MAX_REFERENCE_ATTEMPTS } from "@/app/(dashboard)/purchases/document-actions";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";
import { returnedBySaleItem } from "@/app/(dashboard)/sales/returns/returnable";
import { OverReturnError, overReturnMessage, prepareSaleReturn, writeSaleReturnInTx } from "@/app/(dashboard)/sales/returns/save-return";
import type { ActionFailure } from "../../lib/actionResult";
import { orderRef } from "../../lib/format";
import { planRefund, type RefundSale, type RefundSaleLine } from "../../lib/refund";
import { resolveStockLines } from "../../lib/resolveStockLines";
import type { RefundInput } from "../../schemas/bill";

// Refund (a settled bill) — without the permission check and input parsing
// (../actions/bill.ts). Settled bills are never reopened: corrections are
// retail Sale Returns against the order's Sale, made here so a refunded
// dish's stock goes back right:
//
//   - the return through retail's own return code (prepareSaleReturn →
//     writeSaleReturnInTx: the sale locked, "not more than is left to
//     return" checked, the SR_ reference), Completed, with the refund paid
//     back in full by the method chosen;
//   - its lines priced as on the sale, with their share of the sale's
//     discount and service charge (lib/refund.ts);
//   - "Return to stock" ticked: what those dishes took when the bill was
//     settled goes back in (OrderItem.stockPerUnit — the recipe as it was
//     then); not ticked: no stock moves (the food was eaten or thrown away).
//
// One transaction; a retry with the same key answers with the first refund.

export type RefundResult = { ok: true; saleReturnId: string; reference: string; amount: string; returnedToStock: boolean } | ActionFailure;
export type StockMove = { productId: string; productName: string; quantity: number };

class RefundAbort extends Error {}

const refusal = (state: PurchaseActionState) =>
  state.ok ? "" : (Object.values(state.fieldErrors ?? {}).flat()[0] ?? state.error ?? "The return couldn't be saved.");

async function priorRefund(client: Prisma.TransactionClient, idempotencyKey: string, orderId: string): Promise<RefundResult | null> {
  const done = await client.orderRefund.findUnique({
    where: { idempotencyKey },
    select: { orderId: true, returnedToStock: true, saleReturn: { select: { id: true, reference: true, grandTotal: true } } },
  });
  if (!done) return null;
  if (done.orderId !== orderId) return { ok: false, error: "That refund was for another order." };
  return { ok: true, saleReturnId: done.saleReturn.id, reference: done.saleReturn.reference, amount: done.saleReturn.grandTotal.toFixed(2), returnedToStock: done.returnedToStock };
}

// The sale's lines as a refund sees them, with what earlier returns took.
export async function refundableSale(db: Prisma.TransactionClient, saleId: string): Promise<{ sale: RefundSale; lines: (RefundSaleLine & { productId: string })[] }> {
  const sale = await db.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: {
      discount: true,
      shipping: true,
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, quantity: true, saleUnit: true, netUnitPrice: true, discountType: true, discount: true, taxType: true, orderTax: true, subtotal: true, product: { select: { name: true } } } },
      returns: { where: { deletedAt: null }, select: { discount: true, shipping: true } },
    },
  });
  const returned = await returnedBySaleItem(db, saleId);
  return {
    sale: {
      itemsTotal: sumSubtotals(sale.items.map((i) => i.subtotal.toString())).toFixed(2),
      discount: sale.discount.toFixed(2),
      shipping: sale.shipping.toFixed(2),
      refundedDiscount: sumSubtotals(sale.returns.map((r) => r.discount.toString())).toFixed(2),
      refundedShipping: sumSubtotals(sale.returns.map((r) => r.shipping.toString())).toFixed(2),
    },
    lines: sale.items.map((i) => ({
      saleItemId: i.id,
      productId: i.productId,
      name: i.product.name,
      sold: i.quantity,
      returned: returned.get(i.id) ?? 0,
      unitCost: i.netUnitPrice.toFixed(2),
      discountType: i.discountType,
      discount: i.discount.toFixed(2),
      taxType: i.taxType,
      taxRate: new Decimal(i.orderTax.toString()).toString(),
      saleUnit: i.saleUnit,
    })),
  };
}

export async function refundOrder(input: RefundInput, userId: string): Promise<RefundResult> {
  const today = todayInAppZone();
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<RefundResult> => {
          const prior = await priorRefund(tx, input.idempotencyKey, input.orderId);
          if (prior) return prior;

          // Refunds of an order one at a time (the order, then its sale).
          const locked = await tx.$queryRaw<{ status: string; saleId: string | null }[]>`
            SELECT status, saleId FROM \`Order\` WHERE id = ${input.orderId} AND deletedAt IS NULL FOR UPDATE`;
          const head = locked[0];
          if (!head) return { ok: false, error: "Order not found. It may have been deleted." };
          if (head.status !== "BILLED" || !head.saleId) return { ok: false, error: "Only a settled bill can be refunded." };
          const again = await priorRefund(tx, input.idempotencyKey, input.orderId);
          if (again) return again;

          const order = await tx.order.findUniqueOrThrow({
            where: { id: input.orderId },
            select: {
              number: true,
              warehouseId: true,
              items: {
                where: { deletedAt: null, cancelledAt: null, kitchenStatus: { not: "NEW" } },
                orderBy: { createdAt: "asc" },
                select: {
                  productId: true,
                  stockPerUnit: true,
                  product: { select: { name: true, productType: true, recipeLines: { where: { deletedAt: null }, select: { ingredientId: true, quantity: true, ingredient: { select: { name: true } } } } } },
                },
              },
            },
          });
          const { sale, lines } = await refundableSale(tx, head.saleId);
          const plan = planRefund(sale, lines, input.lines);
          if (!plan.ok) return plan;

          const ref = orderRef(order.number);
          const productOf = new Map(lines.map((line) => [line.saleItemId, line.productId]));
          const notes = `Restaurant ${ref} refund · ${input.reason} · ${input.returnToStock ? "returned to stock" : "not returned to stock"}`;
          const ready = await prepareSaleReturn({
            saleId: head.saleId,
            date: today,
            status: "COMPLETED",
            orderTax: "0",
            discount: plan.discount.toFixed(2),
            shipping: plan.shipping.toFixed(2),
            notes,
            // The return form's shape: retail takes each line's product from the sale line anyway.
            items: plan.items.map((item) => ({ ...item, productId: productOf.get(item.saleItemId)! })),
          });
          if (!ready.ok) throw new RefundAbort(refusal(ready.state));
          const amount = ready.prepared.order.grandTotal.toFixed(2);
          const created = await writeSaleReturnInTx(tx, ready.prepared, userId, {
            moveStock: false,
            refunds: new Decimal(amount).isZero() ? [] : [{ amount, paymentType: input.paymentType, date: new Date(`${today}T00:00:00.000Z`), notes: `Restaurant ${ref} refund` }],
          });

          // Back into stock: what each refunded dish took when settled.
          let stockMoves: StockMove[] | null = null;
          if (input.returnToStock) {
            const moves = new Map<string, StockMove>();
            for (const pick of plan.items) {
              const productId = productOf.get(pick.saleItemId)!;
              const settled = order.items.find((line) => line.productId === productId && Array.isArray(line.stockPerUnit));
              // Settled before the per-dish record existed: its recipe as it is now.
              const perUnit: StockMove[] = settled
                ? (settled.stockPerUnit as StockMove[])
                : (() => {
                    const line = order.items.find((l) => l.productId === productId);
                    if (!line) return [];
                    return resolveStockLines([
                      {
                        productId,
                        productName: line.product.name,
                        productType: line.product.productType,
                        quantity: 1,
                        recipe: line.product.recipeLines.map((r) => ({ ingredientId: r.ingredientId, ingredientName: r.ingredient.name, quantity: r.quantity.toString() })),
                      },
                    ]).map((m) => ({ productId: m.productId, productName: m.productName, quantity: m.quantity.toNumber() }));
                  })();
              for (const unit of perUnit) {
                const quantity = unit.quantity * pick.quantity;
                if (!Number.isInteger(quantity)) throw new RefundAbort(`${unit.productName}: part of a unit (${quantity}) can't go back into stock.`);
                const current = moves.get(unit.productId);
                moves.set(unit.productId, { ...unit, quantity: (current?.quantity ?? 0) + quantity });
              }
            }
            stockMoves = [...moves.values()].sort((a, b) => (a.productId < b.productId ? -1 : 1));
            for (const move of stockMoves) await increaseStock(tx, { productId: move.productId, warehouseId: order.warehouseId, quantity: move.quantity });
          }

          await tx.orderRefund.create({
            data: {
              orderId: input.orderId,
              saleReturnId: created.id,
              idempotencyKey: input.idempotencyKey,
              returnedToStock: input.returnToStock,
              stockMoves: stockMoves ?? Prisma.DbNull,
              createdById: userId,
            },
          });
          return { ok: true, saleReturnId: created.id, reference: created.reference, amount, returnedToStock: input.returnToStock };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 },
      );
    } catch (error) {
      if (error instanceof RefundAbort) return { ok: false, error: error.message };
      if (error instanceof OverReturnError) return { ok: false, error: overReturnMessage(error) };
      if (error instanceof DocumentChangedError) return { ok: false, error: "The bill's sale was changed or deleted. Reload and try again." };
      if (isReferenceCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002" && JSON.stringify(error.meta ?? {}).includes("idempotencyKey")) {
          return (await priorRefund(prisma, input.idempotencyKey, input.orderId)) ?? { ok: false, error: "That refund is already being made." };
        }
        if (error.code === "P2034" && attempt < MAX_REFERENCE_ATTEMPTS) continue;
      }
      throw error;
    }
  }
}

export const refundSummary = (amount: string, reference: string) => `Refunded ${formatNaira(amount)} (${reference}).`;
