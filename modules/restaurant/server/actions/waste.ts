"use server";

import { revalidatePath } from "next/cache";
import { currentDeviceId } from "@/lib/hardware/device";
import { invalid, type ActionFailure } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { logWasteSchema, previewWasteSchema, remakeSchema, voidWasteSchema, type LogWasteField } from "../../schemas/waste";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { getWasteApprovers, type Approver } from "../queries/approvers";
import { getWasteItemOptions, type WasteItemOption } from "../queries/waste";
import { printNewKots } from "../services/printing";
import { remakeLine, type RemakeResult } from "../services/remake";
import { logWasteEntry, voidWasteEntry, wasteCostPreview, type LogWasteResult, type VoidWasteResult, type WasteCostPreview } from "../services/waste";

// Thin wrappers for waste: permission, input parsing and refresh here; the
// rules are in services/waste.ts.

const refresh = () => revalidatePath("/restaurant", "layout");

// Log waste: Log Waste. Above the approval limit the approver's PIN comes
// with it (Approve Waste — checked in the service).
export async function logWaste(input: unknown): Promise<LogWasteResult> {
  return safely("log waste", async (): Promise<LogWasteResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.LOG_WASTE);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = logWasteSchema.safeParse(input);
    if (!parsed.success) return invalid<LogWasteField>(parsed.error.flatten().fieldErrors);

    const result = await logWasteEntry(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// The Log waste form's live cost (nothing written): Log Waste.
export async function previewWasteCost(input: unknown): Promise<WasteCostPreview> {
  return safely("preview waste cost", async (): Promise<WasteCostPreview> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.LOG_WASTE);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = previewWasteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the quantity." };
    return wasteCostPreview(parsed.data.productId, parsed.data.qty);
  });
}

// The kitchen display's waste pop-up, when it opens (not on every 5s
// refresh): the item picker's items and the approvers. Log Waste.
export async function loadWasteOptions(): Promise<{ ok: true; items: WasteItemOption[]; approvers: Approver[] } | ActionFailure> {
  return safely("load waste options", async () => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.LOG_WASTE);
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const [items, approvers] = await Promise.all([getWasteItemOptions(), getWasteApprovers()]);
    return { ok: true as const, items, approvers };
  });
}

// Remake (the kitchen display): the spoilt dishes logged as waste and made
// again at no charge. Log Waste.
export async function remakeKitchenLine(input: unknown): Promise<RemakeResult> {
  return safely("remake line", async (): Promise<RemakeResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.LOG_WASTE);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = remakeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That remake isn't valid." };

    const result = await remakeLine(parsed.data, authCheck.userId);
    if (result.ok) {
      refresh();
      // The REMAKE ticket to its station's printer.
      await printNewKots([result.kotId], { userId: authCheck.userId, deviceId: await currentDeviceId() });
    }
    return result;
  });
}

// Void a waste entry: Approve Waste.
export async function voidWaste(input: unknown): Promise<VoidWasteResult> {
  return safely("void waste", async (): Promise<VoidWasteResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.APPROVE_WASTE);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = voidWasteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That void isn't valid." };

    const result = await voidWasteEntry(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}
