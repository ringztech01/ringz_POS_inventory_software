import "server-only";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { todayInAppZone } from "@/lib/dateRanges";
import { sumSubtotals } from "@/lib/pricing";
import { decreaseStock, InsufficientStockError } from "@/lib/stock";
import { isReferenceCollision, MAX_REFERENCE_ATTEMPTS } from "@/app/(dashboard)/purchases/document-actions";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";
import { addSalePaymentsInTx, notEnoughStock, SalePaymentError, saveSaleInTx } from "@/app/(dashboard)/sales/save-sale";
import { isBilled, summariseBill } from "../../lib/bill";
import { billPartLabel } from "../../lib/billSplit";
import { orderRef } from "../../lib/format";
import { orderToSale, toSalePayments } from "../../lib/orderToSale";
import { resolveStockLines } from "../../lib/resolveStockLines";
import { tender, type Tender } from "../../lib/tender";
import type { SettleInput } from "../../schemas/bill";
import { lockOrderAt, STALE, type OrderFailure } from "./orders";

// Settle (Bill panel → Payment): taking payment for the whole bill or one
// part of a split bill. Without the permission check and input parsing
// (../actions/bill.ts).
//
// One Sale per order (retail's createSale path — saveSaleInTx): the first
// settle makes it with every billed line, takes its payment and moves the
// stock; a later part of a split bill adds its payments to that sale (the
// bill can't change once a part is paid). The order closes (Billed, its
// table free) when nothing is left to pay.

export const PART_GONE = "That part of the bill is no longer there — refreshed.";

export type SettlementPlan =
  | { ok: true; due: Decimal; tender: Extract<Tender, { ok: true }>; partId: string | null; waiterId: string | null }
  | OrderFailure;

// Inside the settle's transaction, with the order locked: what's due — the
// bill total, or the part's amount, both worked out here — and whether the
// payment covers it (lib/tender.ts, run again on the server). Refused: a
// closed order or another version, unsent lines or nothing billed, a split
// bill paid as a whole (or a whole bill paid as a part), a part already
// paid, a split that no longer adds up, a tip with no waiter to give it to.
export async function planSettlement(tx: Prisma.TransactionClient, input: SettleInput, servicePercent: Decimal.Value): Promise<SettlementPlan> {
  const { orderId, version, partId, payments, tip } = input;
  // A split bill is paid part by part, so a paid part doesn't stop the next.
  const locked = await lockOrderAt(tx, orderId, version, { whilePartPaid: true });
  if (!locked.ok) return locked;
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      waiterId: true,
      discountType: true,
      discountValue: true,
      serviceCharge: true,
      items: { select: { quantity: true, unitPrice: true, taxType: true, taxRate: true, kitchenStatus: true, cancelledAt: true, deletedAt: true, remakeOfId: true } },
      billParts: { where: { deletedAt: null }, select: { id: true, amount: true, status: true } },
    },
  });
  const bill = summariseBill(order.items, servicePercent, order);
  if (bill.settleBlocker) return { ok: false, error: bill.settleBlocker };

  const parts = order.billParts;
  let due: Decimal;
  if (partId) {
    const part = parts.find((p) => p.id === partId);
    if (!part) return { ok: false, error: PART_GONE, stale: true };
    if (part.status === "PAID") return { ok: false, error: "That part has already been paid — refreshed.", stale: true };
    due = new Decimal(part.amount.toString());
  } else {
    if (parts.length) return { ok: false, error: "This bill is split — pay it one part at a time.", stale: true };
    due = bill.total;
  }
  if (parts.length && !sumSubtotals(parts.map((p) => p.amount.toString())).equals(bill.total)) {
    return { ok: false, error: "The split no longer adds up to the bill. Split it again before taking payment." };
  }
  if (new Decimal(tip).greaterThan(0) && !order.waiterId) {
    return { ok: false, error: "Tips go to the waiter — choose the waiter on the order first." };
  }

  const tendered = tender(due, tip, payments);
  if (!tendered.ok) return { ok: false, error: tendered.error };
  return { ok: true, due, tender: tendered, partId: partId ?? null, waiterId: order.waiterId };
}

// The checks alone, nothing written.
export async function checkSettlement(input: SettleInput): Promise<SettlementPlan> {
  const { restaurantServiceChargePercent } = await getBusinessSettings();
  return prisma.$transaction((tx) => planSettlement(tx, input, restaurantServiceChargePercent));
}

export type SettleResult =
  | {
      ok: true;
      version: number;
      saleId: string;
      reference: string;
      // The order is Billed (nothing left to pay).
      closed: boolean;
      // What this settle paid (the bill or the part), and the change given.
      paid: string;
      change: string;
    }
  | OrderFailure;

// Rolls the whole settle back with this message.
class SettleAbort extends Error {}

const refusal = (state: PurchaseActionState) =>
  state.ok ? "" : (Object.values(state.fieldErrors ?? {}).flat()[0] ?? state.error ?? "The sale couldn't be saved.");

// A settle already made with this key: its result again (the retry of a
// payment whose answer was lost). Another order's key is refused.
async function priorSettlement(client: Prisma.TransactionClient, idempotencyKey: string, orderId: string): Promise<SettleResult | null> {
  const done = await client.orderSettlement.findUnique({
    where: { idempotencyKey },
    select: { orderId: true, version: true, closedOrder: true, amount: true, change: true, saleId: true, sale: { select: { reference: true } } },
  });
  if (!done) return null;
  if (done.orderId !== orderId) return { ok: false, error: "That payment was for another order." };
  return { ok: true, version: done.version, saleId: done.saleId, reference: done.sale.reference, closed: done.closedOrder, paid: done.amount.toFixed(2), change: done.change.toFixed(2) };
}

// settleOrder, in one transaction (READ COMMITTED, like the kitchen's — every
// read after the order's lock sees what's committed):
//
//   1. Lock and check the order (planSettlement). Refused — but a retry of
//      a settle already made answers with that settle's result.
//   2. First settle: the sale through retail's saveSaleInTx (orderToSale's
//      input, more methods as further payments; no stock moved by it), then
//      the billed lines' stock through resolveStockLines → decreaseStock in
//      the order's warehouse — retail's stock rule: not enough refuses the
//      sale (InsufficientStockError) and everything rolls back. A recipe
//      still in part units (0.25 kg) is refused too.
//      Later parts: their payments on the order's sale.
//   3. The part Paid; tips (the waiter's, by method) and the settlement
//      record (unique idempotencyKey); the order Billed with closedAt once no
//      part is left open — its table is then free (table status is worked
//      out from the order).
//
// Two terminals settling at once: the order lock serialises them; the
// second finds a new version and is refused (or, with the same key, gets
// the first's result). A line added meanwhile either comes first (the
// settle is refused: another version) or after (refused: the order is
// closed) — never lost.
export async function settleOrder(input: SettleInput, userId: string): Promise<SettleResult> {
  const { restaurantServiceChargePercent: servicePercent } = await getBusinessSettings();
  const walkIn = await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null }, select: { id: true } });
  const today = todayInAppZone();

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx): Promise<SettleResult> => {
          const plan = await planSettlement(tx, input, servicePercent);
          if (!plan.ok) return (await priorSettlement(tx, input.idempotencyKey, input.orderId)) ?? plan;
          const prior = await priorSettlement(tx, input.idempotencyKey, input.orderId);
          if (prior) return prior;

          const order = await tx.order.findUniqueOrThrow({
            where: { id: input.orderId },
            select: {
              number: true,
              type: true,
              warehouseId: true,
              customerId: true,
              saleId: true,
              discountType: true,
              discountValue: true,
              serviceCharge: true,
              table: { select: { name: true } },
              waiter: { select: { firstName: true } },
              warehouse: { select: { name: true } },
              billParts: { where: { deletedAt: null }, orderBy: { number: "asc" }, select: { id: true, number: true, mode: true } },
              items: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  productId: true,
                  quantity: true,
                  unitPrice: true,
                  taxType: true,
                  taxRate: true,
                  kitchenStatus: true,
                  cancelledAt: true,
                  deletedAt: true,
                  remakeOfId: true,
                  product: {
                    select: {
                      name: true,
                      productType: true,
                      recipeLines: { where: { deletedAt: null }, select: { ingredientId: true, quantity: true, ingredient: { select: { name: true } } } },
                    },
                  },
                },
              },
            },
          });
          const ref = orderRef(order.number);
          const parts = order.billParts;
          const part = plan.partId ? parts.find((p) => p.id === plan.partId)! : null;
          const partLabel = part ? billPartLabel(part.mode, part.number, parts.length) : undefined;
          const now = new Date();

          let saleId = order.saleId;
          let reference: string;
          if (!saleId) {
            if (!order.customerId && !walkIn) throw new SettleAbort("The walk-in customer is missing, so there's no one to make the sale for. Check Peoples › Customers.");
            const sale = orderToSale(
              { ...order, ref, table: order.table?.name ?? null, waiter: order.waiter?.firstName ?? null, lines: order.items },
              { servicePercent, payments: plan.tender.payments, date: today, walkInCustomerId: walkIn?.id ?? "", paymentNote: partLabel },
            );
            if (!sale.ok) throw new SettleAbort(sale.error);
            const saved = await saveSaleInTx(tx, sale.input, userId, { moveStock: false, morePayments: sale.morePayments });
            if (!saved.ok) throw new SettleAbort(refusal(saved.state));
            saleId = saved.id;
            reference = saved.reference;

            const sold = order.items.filter(isBilled).map((line) => ({
              id: line.id,
              productId: line.productId,
              productName: line.product.name,
              productType: line.product.productType,
              quantity: line.quantity,
              recipe: line.product.recipeLines.map((r) => ({ ingredientId: r.ingredientId, ingredientName: r.ingredient.name, quantity: r.quantity.toString() })),
            }));
            for (const move of resolveStockLines(sold)) {
              if (!move.quantity.isInteger()) {
                throw new SettleAbort(`${move.productName}: a recipe uses part of a unit (${move.quantity.toString()} in all). Recipes take whole units — fix it in Food › Recipes, then settle.`);
              }
              await decreaseStock(tx, { productId: move.productId, warehouseId: order.warehouseId, quantity: move.quantity.toNumber(), productName: move.productName, warehouseName: order.warehouse.name });
            }
            // What one of each line took, as settled — what a refund puts back (Step 7).
            for (const line of sold) {
              const perUnit = resolveStockLines([{ ...line, quantity: 1 }]).map((m) => ({ productId: m.productId, productName: m.productName, quantity: m.quantity.toNumber() }));
              await tx.orderItem.update({ where: { id: line.id }, data: { stockPerUnit: perUnit } });
            }
            await tx.order.update({ where: { id: input.orderId }, data: { saleId } });
          } else {
            const note = [`Restaurant ${ref}`, partLabel].filter(Boolean).join(" · ");
            await addSalePaymentsInTx(tx, saleId, toSalePayments(plan.tender.payments, today, note), userId);
            reference = (await tx.sale.findUniqueOrThrow({ where: { id: saleId }, select: { reference: true } })).reference;
          }

          if (part) {
            const paid = await tx.orderBillPart.updateMany({ where: { id: part.id, status: "OPEN", deletedAt: null }, data: { status: "PAID", paidAt: now } });
            if (paid.count !== 1) throw new SettleAbort("That part has already been paid — refreshed.");
          }
          const closed = part ? (await tx.orderBillPart.count({ where: { orderId: input.orderId, deletedAt: null, status: "OPEN" } })) === 0 : true;
          const { version } = await tx.order.update({
            where: { id: input.orderId },
            data: closed ? { status: "BILLED", closedAt: now, version: { increment: 1 } } : { version: { increment: 1 } },
            select: { version: true },
          });

          const tipTotal = sumSubtotals(plan.tender.tips.map((t) => t.amount));
          const settlement = await tx.orderSettlement.create({
            data: {
              orderId: input.orderId,
              partId: part?.id ?? null,
              idempotencyKey: input.idempotencyKey,
              saleId,
              amount: plan.due.toFixed(2),
              tip: tipTotal.toFixed(2),
              change: plan.tender.change.toFixed(2),
              version,
              closedOrder: closed,
              createdById: userId,
            },
            select: { id: true },
          });
          if (plan.tender.tips.length && plan.waiterId) {
            await tx.orderTip.createMany({
              data: plan.tender.tips.map((t) => ({ settlementId: settlement.id, orderId: input.orderId, waiterId: plan.waiterId!, paymentType: t.paymentType, amount: t.amount.toFixed(2) })),
            });
          }
          return { ok: true, version, saleId, reference, closed, paid: plan.due.toFixed(2), change: plan.tender.change.toFixed(2) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 },
      );
    } catch (error) {
      if (error instanceof SettleAbort || error instanceof SalePaymentError) return { ok: false, error: error.message };
      if (error instanceof InsufficientStockError) return { ok: false, error: refusal(notEnoughStock(error)) };
      if (isReferenceCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // The same payment sent twice at once: the first one's result.
        if (error.code === "P2002" && JSON.stringify(error.meta ?? {}).includes("idempotencyKey")) {
          return (await priorSettlement(prisma, input.idempotencyKey, input.orderId)) ?? { ok: false, error: STALE, stale: true };
        }
        // A write conflict or deadlock (another screen or the till got there first).
        if (error.code === "P2034") {
          if (attempt < MAX_REFERENCE_ATTEMPTS) continue;
          return { ok: false, error: STALE, stale: true };
        }
      }
      throw error;
    }
  }
}
