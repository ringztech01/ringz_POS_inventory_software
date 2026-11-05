"use server";

import { revalidatePath } from "next/cache";
import { currentDeviceId } from "@/lib/hardware/device";
import type { QueueAnswer } from "@/components/hardware/PrintButton";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { BILL_ORDER_GONE, registerBillPrint } from "../services/bill";
import { printPrebill, printRestaurantReceipt, reprintKot } from "../services/printing";

// The restaurant's Print buttons when their role has a printer (the print
// queue): Print KOT (Kitchen Display), Print bill and Print receipt (Manage
// Orders). { printer: null }: no printer any more — the screen opens its
// browser page instead.

const answer = (queued: { queued: true; printer: string } | { queued: false } | null, missing: string): QueueAnswer =>
  !queued ? { ok: false, error: missing } : { ok: true, printer: queued.queued ? queued.printer : null };

export async function printKotAction(kotId: unknown): Promise<QueueAnswer> {
  return safely("print KOT", async (): Promise<QueueAnswer> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = idSchema.safeParse(kotId);
    if (!parsed.success) return { ok: false, error: "That ticket no longer exists." };
    return answer(await reprintKot(parsed.data, { userId: auth.userId, deviceId: await currentDeviceId() }), "That ticket no longer exists.");
  });
}

// The pre-bill: recorded as printed (as the print page does), then queued.
export async function printBillAction(orderId: unknown): Promise<QueueAnswer> {
  return safely("print bill", async (): Promise<QueueAnswer> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = idSchema.safeParse(orderId);
    if (!parsed.success) return { ok: false, error: BILL_ORDER_GONE };
    const queued = await printPrebill(parsed.data, { userId: auth.userId, deviceId: await currentDeviceId() });
    if (queued?.queued) {
      const recorded = await registerBillPrint(parsed.data);
      if (!recorded.ok) return recorded;
      revalidatePath("/restaurant", "layout");
    }
    return answer(queued, BILL_ORDER_GONE);
  });
}

export async function printReceiptAction(saleId: unknown): Promise<QueueAnswer> {
  return safely("print receipt", async (): Promise<QueueAnswer> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = idSchema.safeParse(saleId);
    if (!parsed.success) return { ok: false, error: "That sale no longer exists." };
    return answer(await printRestaurantReceipt(parsed.data, { userId: auth.userId, deviceId: await currentDeviceId() }, true), "That sale no longer exists.");
  });
}
