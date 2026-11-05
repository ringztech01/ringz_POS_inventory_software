"use server";

import { revalidatePath } from "next/cache";
import { revalidateDocumentPaths } from "@/app/(dashboard)/purchases/document-actions";
import { invalid, type ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { approvalPinSchema, clearSplitSchema, orderDiscountSchema, refundSchema, serviceChargeSchema, settleSchema, splitBillSchema } from "../../schemas/bill";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { setApprovalPin } from "../services/approvalPins";
import {
  applyOrderDiscount,
  BILL_ORDER_GONE,
  clearOrderSplit,
  registerBillPrint,
  setOrderServiceCharge,
  splitOrderBill,
  type DiscountResult,
} from "../services/bill";
import type { OrderChangeResult } from "../services/orders";
import { refundOrder, type RefundResult } from "../services/refund";
import { settleOrder, type SettleResult } from "../services/settle";

// Thin wrappers for the bill: permission, input parsing and refresh here;
// the rules are in services/bill.ts.

const refresh = () => revalidatePath("/restaurant", "layout");

// Print bill (pre-bill): waiters print it, so Manage Orders is enough.
export async function printOrderBill(rawOrderId: unknown): Promise<ActionResult> {
  return safely("print bill", async (): Promise<ActionResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = idSchema.safeParse(rawOrderId);
    if (!parsed.success) return { ok: false, error: BILL_ORDER_GONE };

    const result = await registerBillPrint(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// Discount on the bill. Anyone taking orders can give one up to the limit;
// above it the approver's PIN comes with it (checked in the service).
export async function applyDiscount(input: unknown): Promise<DiscountResult> {
  return safely("apply discount", async (): Promise<DiscountResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = orderDiscountSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That discount isn't valid." };

    const result = await applyOrderDiscount(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// The bill's Service charge switch.
export async function setServiceCharge(input: unknown): Promise<OrderChangeResult> {
  return safely("set service charge", async (): Promise<OrderChangeResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = serviceChargeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid." };

    const result = await setOrderServiceCharge(parsed.data.orderId, parsed.data.version, parsed.data.on);
    if (result.ok) refresh();
    return result;
  });
}

// My approval PIN: the signed-in user's own, so Approve Discount is needed.
export async function saveApprovalPin(input: unknown): Promise<ActionResult<"pin" | "confirm">> {
  return safely("save approval PIN", async (): Promise<ActionResult<"pin" | "confirm">> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = approvalPinSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

    const result = await setApprovalPin(authCheck.userId, parsed.data.pin);
    if (result.ok) refresh();
    return result;
  });
}

// Split bill: equal, by item or by amount. The server works out the parts.
export async function splitBill(input: unknown): Promise<OrderChangeResult> {
  return safely("split bill", async (): Promise<OrderChangeResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = splitBillSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That split isn't valid." };

    const result = await splitOrderBill(parsed.data.orderId, parsed.data.version, parsed.data.split);
    if (result.ok) refresh();
    return result;
  });
}

// Pay as one bill.
export async function removeBillSplit(input: unknown): Promise<OrderChangeResult> {
  return safely("remove bill split", async (): Promise<OrderChangeResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = clearSplitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid." };

    const result = await clearOrderSplit(parsed.data.orderId, parsed.data.version);
    if (result.ok) refresh();
    return result;
  });
}

export type { RefundResult, SettleResult };

// Settle (Payment pop-up): Settle Bill only. The amount due comes from the
// server; the browser sends what was handed over, by method, and the tip.
// The sale is retail's, so the Sales pages refresh too.
export async function settleBill(input: unknown): Promise<SettleResult> {
  return safely("settle bill", async (): Promise<SettleResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.SETTLE_BILL);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = settleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That payment isn't valid." };

    const result = await settleOrder(parsed.data, authCheck.userId);
    if (result.ok) {
      refresh();
      revalidateDocumentPaths("/sales", [], result.saleId);
    }
    return result;
  });
}

// Refund (a settled bill): Settle Bill — whoever takes payment gives it
// back. Saved as a retail Sale Return against the order's sale, so the
// Sales pages refresh too.
export async function refundBill(input: unknown): Promise<RefundResult> {
  return safely("refund bill", async (): Promise<RefundResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.SETTLE_BILL);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = refundSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That refund isn't valid." };

    const result = await refundOrder(parsed.data, authCheck.userId);
    if (result.ok) {
      refresh();
      revalidatePath("/sales/returns");
      revalidatePath("/sales", "layout");
    }
    return result;
  });
}
