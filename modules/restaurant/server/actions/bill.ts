"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { currentDeviceId } from "@/lib/hardware/device";
import { openDrawerForCash } from "@/lib/hardware/drawer";
import { tookCash } from "@/lib/hardware/drawerKick";
import { revalidateDocumentPaths } from "@/app/(dashboard)/purchases/document-actions";
import type { ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { clearSplitSchema, orderDiscountSchema, refundSchema, serviceChargeSchema, settleSchema, splitBillSchema } from "../../schemas/bill";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";
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
import { printRestaurantReceipt } from "../services/printing";
import { getPaymentSettings } from "../services/paymentSettings";
import { isTabletRequest } from "../tabletDevice";

// Thin wrappers for the bill: permission, input parsing and refresh here;
// the rules are in services/bill.ts.

// The restaurant pages and the touch POS (/pos in Restaurant mode).
const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos");
};

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

    // On a tablet every discount needs a manager's PIN (and is logged).
    const result = await applyOrderDiscount(parsed.data, authCheck.userId, { alwaysApprove: await isTabletRequest() });
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

// My PIN (Part 6f): PINs are set by an Administrator in Settings › Staff;
// changing your own (when allowed) is changeOwnPin in actions/staff.ts.

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
// The sale is retail's, so the Sales pages refresh too. With a receipt
// printer the receipt prints at once (once per sale); `receiptPrinter` says
// where (null: the screen offers the receipt page as before). Cash taken:
// this till's cash drawer opens first (once per settle, even if retried).
export async function settleBill(input: unknown): Promise<SettleResult & { receiptPrinter?: string | null }> {
  return safely("settle bill", async (): Promise<SettleResult & { receiptPrinter?: string | null }> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.SETTLE_BILL);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = settleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That payment isn't valid." };
    // A tablet asks for a tip only when Settings › Restaurant › Payments says so.
    if (Number(parsed.data.tip) > 0 && (await isTabletRequest()) && !(await getPaymentSettings()).tabletTips) return { ok: false, error: "Tips are off on the tablets (Settings › Restaurant › Payments)." };

    const result = await settleOrder(parsed.data, authCheck.userId, { deviceId: await currentDeviceId() });
    // A training order (Step 7f): no drawer, no receipt.
    if (result.ok && result.training) {
      refresh();
      return { ...result, receiptPrinter: null };
    }
    if (result.ok) {
      refresh();
      revalidateDocumentPaths("/sales", [], result.saleId);
      const deviceId = await currentDeviceId();
      if (tookCash(parsed.data.payments)) {
        await openDrawerForCash({ reason: "CASH_SALE", userId: authCheck.userId, deviceId, refId: result.saleId, refLabel: result.reference, dedupeKey: `DRAWER:SETTLE:${parsed.data.idempotencyKey}` });
      }
      try {
        const printed = await printRestaurantReceipt(result.saleId, { userId: authCheck.userId, deviceId }, false);
        return { ...result, receiptPrinter: printed?.queued ? printed.printer : null };
      } catch (error) {
        console.error("[print] couldn't queue the receipt:", error);
        return { ...result, receiptPrinter: null };
      }
    }
    return result;
  });
}

// Refund (a settled bill): Settle Bill — whoever takes payment gives it
// back. Saved as a retail Sale Return against the order's sale, so the
// Sales pages refresh too. Cash given back: this till's drawer opens (once).
export async function refundBill(input: unknown): Promise<RefundResult> {
  return safely("refund bill", async (): Promise<RefundResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.SETTLE_BILL);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = refundSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That refund isn't valid." };

    const mayRefund = (await getCurrentUserPermissions()).permissions.has(RESTAURANT_PERMISSIONS.APPROVE_VOID);
    const result = await refundOrder(parsed.data, authCheck.userId, { mayRefund, deviceId: await currentDeviceId() });
    if (result.ok) {
      refresh();
      revalidatePath("/sales/returns");
      revalidatePath("/sales", "layout");
      if (tookCash([{ paymentType: parsed.data.paymentType, amount: result.amount }])) {
        await openDrawerForCash({ reason: "CASH_REFUND", userId: authCheck.userId, deviceId: await currentDeviceId(), refId: result.saleReturnId, refLabel: result.reference, dedupeKey: `DRAWER:REFUND:${parsed.data.idempotencyKey}` });
      }
    }
    return result;
  });
}
