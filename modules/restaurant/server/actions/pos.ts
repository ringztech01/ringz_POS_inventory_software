"use server";

import { revalidatePath } from "next/cache";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { createSwitchToken } from "@/lib/auth/posSwitch";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import type { ActionResult } from "../../lib/actionResult";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { newPosOrderSchema, paymentSettingsSchema, posDrawerSchema, posSettingsSchema, posSwitchSchema } from "../../schemas/pos";
import { setPaymentSettings } from "../services/paymentSettings";
import { currentDeviceId } from "@/lib/hardware/device";
import { openDrawerByHand, type DrawerAnswer } from "@/lib/hardware/drawer";
import { PERMISSIONS } from "@/lib/permissions";
import type { NeedsManager } from "../services/approvalPins";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { checkUserPin, findByPin, logOverride, requireManager, WRONG_PIN } from "../services/approvalPins";
import { createCounterOrder, discardEmptyOrder, type OpenOrderResult } from "../services/floor";
import { idSchema } from "../../schemas/common";
import { setPosSettings } from "../services/menuGroups";
import { canTakeOrdersWhere } from "../services/orders";
import { shiftStatus } from "../services/shifts";
import { findByCard } from "../services/staffCard";
import { writeAudit } from "@/lib/audit";

// The touch POS's own actions (Part 6e Step 5): a new takeaway or bar tab,
// the waiter switch by PIN, and its settings.

const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos", "layout");
};

// Takeaway, or a bar tab with a name — the signed-in waiter's.
export async function newPosOrder(input: unknown): Promise<OpenOrderResult> {
  return safely("new POS order", async (): Promise<OpenOrderResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = newPosOrderSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That order can't be opened." };
    const result = await createCounterOrder(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// Leaving an order (Tables, a new takeaway…) with nothing on it: it's thrown
// away so its table isn't held (services/floor.ts discardEmptyOrder decides).
export async function leaveEmptyOrder(orderId: unknown): Promise<ActionResult & { discarded?: boolean }> {
  return safely("leave empty order", async () => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const id = idSchema.safeParse(orderId);
    if (!id.success) return { ok: false as const, error: "That order can't be found." };
    const result = await discardEmptyOrder(id.data);
    if (result.discarded) refresh();
    return result;
  });
}

// PIN-only sign-in guessing, held back per till: five wrong PINs and the
// pad waits 30 seconds (the PIN Login design). Kept in this server's memory.
const GUESS_TRIES = 5;
const GUESS_WAIT_MS = 30_000;
const guessStore = globalThis as unknown as { __posPinGuesses?: Map<string, { fails: number; until: number }> };
const guesses = (guessStore.__posPinGuesses ??= new Map());

// The waiter switch: on a till that's signed in, someone who takes orders
// types their PIN — with their name tapped first, or without (the PIN finds
// them; a PIN two people share asks for the name). Five wrong ones with a
// name lock that PIN for five minutes; five wrong without one make this
// till wait 30 seconds. The till is then theirs. Their own PIN while it's
// theirs already just unlocks the screen.
export async function switchPosUser(input: unknown): Promise<ActionResult & { name?: string; userId?: string; switched?: boolean; askShift?: boolean }> {
  return safely("switch POS user", async () => {
    if (!(await isModuleEnabled("restaurant"))) return { ok: false as const, error: "The Restaurant module is turned off." };
    const current = await getCurrentUserPermissions();
    if (!current.userId) return { ok: false as const, error: "Sign this till in first." };
    // A staff card read by the scanner (Step 7d) instead of the PIN: held
    // back per till the same way.
    const card = typeof input === "object" && input !== null && typeof (input as { card?: unknown }).card === "string" ? (input as { card: string }).card.slice(0, 200) : null;
    const parsed = card ? null : posSwitchSchema.safeParse(input);
    if (parsed && !parsed.success) return { ok: false as const, error: "Your PIN is 4 to 6 digits." };

    const userId = parsed?.data?.userId;
    let checked: { ok: true; user: { id: string; firstName: string } } | { ok: false; error: string };
    if (card) {
      const till = `${current.userId}:${(await currentDeviceId()) ?? "-"}`;
      const held = guesses.get(till);
      if (held && held.until > Date.now()) return { ok: false as const, error: `Too many attempts · wait ${Math.ceil((held.until - Date.now()) / 1000)} seconds` };
      const found = await findByCard(card, canTakeOrdersWhere());
      if (found) {
        guesses.delete(till);
        checked = { ok: true, user: found };
      } else {
        const fails = (held && held.until <= Date.now() && held.until > 0 ? 0 : (held?.fails ?? 0)) + 1;
        guesses.set(till, fails >= GUESS_TRIES ? { fails: 0, until: Date.now() + GUESS_WAIT_MS } : { fails, until: 0 });
        checked = { ok: false, error: fails >= GUESS_TRIES ? "Too many attempts · wait 30 seconds" : "That card isn't anyone's here." };
      }
    } else if (userId && parsed?.success) {
      checked = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({ where: { id: userId, ...canTakeOrdersWhere() }, select: { id: true, firstName: true } });
        if (!user) return { ok: false as const, error: "That person can't use the POS. Pick someone else." };
        const pin = await checkUserPin(tx, user.id, parsed.data.pin, user.firstName);
        return pin.ok ? { ok: true as const, user } : pin;
      });
    } else if (parsed?.success) {
      const till = `${current.userId}:${(await currentDeviceId()) ?? "-"}`;
      const held = guesses.get(till);
      if (held && held.until > Date.now()) return { ok: false as const, error: `Too many attempts · wait ${Math.ceil((held.until - Date.now()) / 1000)} seconds` };
      const found = await findByPin(parsed.data.pin, canTakeOrdersWhere());
      if (found.kind === "one") {
        guesses.delete(till);
        checked = { ok: true, user: found.user };
      } else if (found.kind === "shared") {
        checked = { ok: false, error: "Someone else has that PIN too — tap your name first." };
      } else {
        const fails = (held && held.until <= Date.now() && held.until > 0 ? 0 : (held?.fails ?? 0)) + 1;
        guesses.set(till, fails >= GUESS_TRIES ? { fails: 0, until: Date.now() + GUESS_WAIT_MS } : { fails, until: 0 });
        checked = { ok: false, error: fails >= GUESS_TRIES ? "Too many attempts · wait 30 seconds" : `${WRONG_PIN} Try again.` };
      }
    } else {
      checked = { ok: false, error: "Your PIN is 4 to 6 digits." };
    }
    if (!checked.ok) return checked;
    const askShift = (await shiftStatus(checked.user.id)).askStart;
    if (checked.user.id === current.userId) return { ok: true as const, name: checked.user.firstName, userId: checked.user.id, switched: false, askShift };

    const token = createSwitchToken(checked.user.id);
    if (!token) return { ok: false as const, error: "Signing in by PIN needs NEXTAUTH_SECRET in .env." };
    try {
      const url = await signIn("pos-switch", { token, redirect: false });
      if (typeof url === "string" && url.includes("error=")) return { ok: false as const, error: "Couldn't sign in. Try again." };
    } catch {
      return { ok: false as const, error: "Couldn't sign in. Try again." };
    }
    // Logged for the audit view (Step 7e): who took over the till from whom.
    await writeAudit({ userId: checked.user.id, action: "pos.switch", entityType: "Device", entityId: await currentDeviceId(), meta: { method: card ? "card" : "pin", from: current.userId } }).catch(() => undefined);
    return { ok: true as const, name: checked.user.firstName, userId: checked.user.id, switched: true, askShift };
  });
}

// Touch POS settings: after a dish is added, after Send, and auto-lock.
export async function savePosSettings(input: unknown): Promise<ActionResult> {
  return safely("save POS settings", async (): Promise<ActionResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = posSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Those settings can't be saved." };
    const result = await setPosSettings(parsed.data);
    if (result.ok) refresh();
    return result;
  });
}

// Settings › Restaurant › Payments: the tablet's tip step.
export async function savePaymentSettings(input: unknown): Promise<ActionResult> {
  return safely("save payment settings", async (): Promise<ActionResult> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = paymentSettingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Those settings can't be saved." };
    const result = await setPaymentSettings(parsed.data);
    if (result.ok) {
      revalidatePath("/settings/restaurant/payments");
      revalidatePath("/t", "layout");
    }
    return result;
  });
}

// Open drawer from the touch POS (More…): someone with Open Drawer opens it;
// anyone else with the PIN of someone who has it — the drawer log's note
// then says who approved. A reason either way.
export async function openPosDrawer(input: unknown): Promise<DrawerAnswer | NeedsManager> {
  return safely("open POS drawer", async (): Promise<DrawerAnswer | NeedsManager> => {
    const authCheck = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = posDrawerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Say why you're opening the drawer." };
    const may = (await getCurrentUserPermissions()).permissions.has(PERMISSIONS.OPEN_DRAWER);
    const deviceId = await currentDeviceId();
    const manager = await prisma.$transaction(async (tx) => {
      const approved = await requireManager(tx, { for: "DRAWER", may, approval: parsed.data.managerApproval });
      if (approved.ok && approved.approverId) await logOverride(tx, { kind: "drawer", actorId: authCheck.userId, approverId: approved.approverId, entityType: "Device", entityId: deviceId, meta: { reason: parsed.data.reason } });
      return approved;
    });
    if (!manager.ok) return manager;
    const note = manager.approvedBy ? `${parsed.data.reason} · approved by ${manager.approvedBy}`.slice(0, 140) : parsed.data.reason;
    return openDrawerByHand({ note, userId: authCheck.userId, deviceId });
  });
}
