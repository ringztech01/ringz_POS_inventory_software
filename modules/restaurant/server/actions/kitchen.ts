"use server";

import { revalidatePath } from "next/cache";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { kitchenLineSchema, kitchenTicketSchema } from "../../schemas/kds";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { advanceLine, bumpTicket, recallLine, recallTicket, type KitchenResult } from "../services/kitchen";
import { registerPrint, type PrintResult } from "../services/kots";

// Thin wrappers for the kitchen display: Manage Kitchen, input parsing and
// refresh here; the rules are in services/kitchen.ts.

const requireManageKitchen = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_KITCHEN);
// The board, the floor plan and order screens all show line states.
const refresh = () => revalidatePath("/restaurant", "layout");

async function run<T>(label: string, input: unknown, schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, change: (data: T) => Promise<KitchenResult>): Promise<KitchenResult> {
  return safely(label, async (): Promise<KitchenResult> => {
    const authCheck = await requireManageKitchen();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That change isn't valid — refresh and try again." };

    const result = await change(parsed.data);
    if (result.ok || result.stale) refresh();
    return result;
  });
}

// Tap a line: Sent → Preparing → Ready.
export async function advanceKitchenLine(input: unknown): Promise<KitchenResult> {
  return run("advance kitchen line", input, kitchenLineSchema, ({ itemId, from }) => advanceLine(itemId, from));
}

// Tap its pill: Ready → Preparing → Sent.
export async function recallKitchenLine(input: unknown): Promise<KitchenResult> {
  return run("recall kitchen line", input, kitchenLineSchema, ({ itemId, from }) => recallLine(itemId, from));
}

// All ready: the whole ticket to Ready, bumped.
export async function bumpKitchenTicket(input: unknown): Promise<KitchenResult> {
  return run("bump kitchen ticket", input, kitchenTicketSchema, ({ kotId }) => bumpTicket(kotId));
}

// Recall: a bumped ticket back on the board.
export async function recallKitchenTicket(input: unknown): Promise<KitchenResult> {
  return run("recall kitchen ticket", input, kitchenTicketSchema, ({ kotId }) => recallTicket(kotId));
}

// Print KOT (the print page): counts the print. Kitchen Display is enough.
export async function registerKotPrint(input: unknown): Promise<PrintResult> {
  return safely("register KOT print", async (): Promise<PrintResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = kitchenTicketSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That ticket can't be printed." };

    const result = await registerPrint(parsed.data.kotId);
    if (result.ok) refresh();
    return result;
  });
}
