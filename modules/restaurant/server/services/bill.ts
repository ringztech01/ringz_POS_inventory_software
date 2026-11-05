import "server-only";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import type { ActionFailure, ActionResult } from "../../lib/actionResult";
import { checkDiscount, isBilled, summariseBill } from "../../lib/bill";
import { splitByAmounts, splitByItems, splitEqually, type SplitResult } from "../../lib/billSplit";
import { EDITABLE_ORDER_STATUSES } from "../../lib/orderLines";
import type { BillSplit, OrderDiscountInput } from "../../schemas/bill";
import { checkApproverPin } from "./approvalPins";
import { clearSplit, lockOrderAt, markBillChanged, type OrderChangeResult } from "./orders";

// Bill & settle — without the permission check and input parsing
// (../actions/bill.ts).

export const BILL_ORDER_GONE = "That order is closed or no longer exists — refreshed.";

// Print bill (the pre-bill, "NOT A RECEIPT"): records when it was printed,
// and that it's up to date again. Nothing else changes — not the status,
// not the version (a waiter mid-edit isn't interrupted).
export async function registerBillPrint(orderId: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const printed = await tx.order.updateMany({
      where: { id: orderId, deletedAt: null, status: { in: [...EDITABLE_ORDER_STATUSES] } },
      data: { billPrintedAt: new Date(), billChangedAt: null },
    });
    return printed.count === 1 ? { ok: true } : { ok: false, error: BILL_ORDER_GONE };
  });
}

// `needsApproval`: the discount is above the limit and came without an
// approver — the Bill panel then asks for one and their PIN.
export type DiscountResult = OrderChangeResult | (ActionFailure & { needsApproval: true; limit: string });

const NO_DISCOUNT = { discountType: null, discountValue: 0, discountReason: null, discountById: null, discountApprovedById: null };

// Discount on the bill: a % of the sub total or an amount, with its reason
// and who gave it. Checked against the billed lines as they are now (the
// order is locked): an amount can't be more than the sub total, and more
// than the limit (BusinessSetting.restaurantDiscountLimitPercent) needs an
// approver with Approve Discount and their PIN — recorded on the order. A
// value of 0 removes the discount.
export async function applyOrderDiscount(input: OrderDiscountInput, userId: string): Promise<DiscountResult> {
  const { orderId, version, type, value, reason, approval } = input;
  const { restaurantDiscountLimitPercent: limit } = await getBusinessSettings();
  return prisma.$transaction(async (tx): Promise<DiscountResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;

    let data;
    if (new Decimal(value).isZero()) {
      data = NO_DISCOUNT;
    } else {
      const lines = await tx.orderItem.findMany({
        where: { orderId },
        select: { quantity: true, unitPrice: true, taxType: true, taxRate: true, kitchenStatus: true, cancelledAt: true, deletedAt: true, remakeOfId: true },
      });
      const check = checkDiscount(summariseBill(lines, 0).subTotal, type, value, limit);
      if (!check.ok) return check;

      let approvedById: string | null = null;
      if (check.needsApproval) {
        const limitText = `${new Decimal(limit.toString()).toString()}%`;
        if (!approval) return { ok: false, error: `A discount over ${limitText} needs an approver's PIN.`, needsApproval: true, limit: limitText };
        const approved = await checkApproverPin(tx, approval.approverId, approval.pin);
        if (!approved.ok) return approved;
        approvedById = approval.approverId;
      }
      data = { discountType: type, discountValue: value, discountReason: reason, discountById: userId, discountApprovedById: approvedById };
    }

    await markBillChanged(tx, orderId);
    await clearSplit(tx, orderId);
    const updated = await tx.order.update({ where: { id: orderId }, data: { ...data, version: { increment: 1 } }, select: { version: true } });
    return { ok: true, version: updated.version };
  });
}

// The bill's Service charge switch (on for every new order).
export async function setOrderServiceCharge(orderId: string, version: number, on: boolean): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    await markBillChanged(tx, orderId);
    await clearSplit(tx, orderId);
    const updated = await tx.order.update({ where: { id: orderId }, data: { serviceCharge: on, version: { increment: 1 } }, select: { version: true } });
    return { ok: true, version: updated.version };
  });
}

// Split bill: replaces any split (none of it can be paid — lockOrderAt
// refuses then) with parts worked out here from the billed lines and the
// order's own totals, adding up exactly to the bill total. Only a bill that
// could be settled can be split: nothing unsent, something billed.
export async function splitOrderBill(orderId: string, version: number, split: BillSplit): Promise<OrderChangeResult> {
  const { restaurantServiceChargePercent } = await getBusinessSettings();
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        discountType: true,
        discountValue: true,
        serviceCharge: true,
        items: {
          orderBy: { createdAt: "asc" },
          select: { id: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, kitchenStatus: true, cancelledAt: true, deletedAt: true, remakeOfId: true, product: { select: { name: true } } },
        },
      },
    });
    const bill = summariseBill(order.items, restaurantServiceChargePercent, order);
    if (bill.settleBlocker) return { ok: false, error: bill.settleBlocker };

    const result: SplitResult =
      split.mode === "EQUAL" ? splitEqually(bill.total, split.ways)
      : split.mode === "AMOUNT" ? splitByAmounts(bill.total, split.amounts)
      : splitByItems(order.items.filter(isBilled).map((line) => ({ ...line, name: line.product.name })), split.parts, bill);
    if (!result.ok) return result;

    await clearSplit(tx, orderId);
    for (const [i, amount] of result.amounts.entries()) {
      await tx.orderBillPart.create({
        data: {
          orderId,
          number: i + 1,
          mode: split.mode,
          amount: amount.toFixed(2),
          // By item: the units this guest pays for (a line twice → added up).
          lines:
            split.mode === "ITEMS"
              ? {
                  create: [...Map.groupBy(split.parts[i], (a) => a.lineId)].map(([orderItemId, picks]) => ({
                    orderItemId,
                    quantity: picks.reduce((n, a) => n + a.quantity, 0),
                  })),
                }
              : undefined,
        },
      });
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } }, select: { version: true } });
    return { ok: true, version: updated.version };
  });
}

// Pay as one bill: the split's parts go (none can be paid yet).
export async function clearOrderSplit(orderId: string, version: number): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    if ((await tx.orderBillPart.count({ where: { orderId, deletedAt: null } })) === 0) return { ok: true, version };
    await clearSplit(tx, orderId);
    const updated = await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } }, select: { version: true } });
    return { ok: true, version: updated.version };
  });
}
