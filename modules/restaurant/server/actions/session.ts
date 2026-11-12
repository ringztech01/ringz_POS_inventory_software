"use server";

import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { pinTerminalId } from "@/lib/auth/pinTerminal";
import { currentDeviceId } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import type { ActionResult } from "../../lib/actionResult";
import { restaurantModule } from "../../manifest";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import { endShift, setClockInOut, startShift, type Handover } from "../services/shifts";

// Sessions and switching user (Part 6f Step 6). LOCK, the user chip and
// auto-lock on a PIN terminal end the session there and then (the PIN screen
// comes back); elsewhere the screen locks and the session stays until a PIN
// switches it. Unsent lines are already saved on the order — nothing is
// lost. Clock in / out: "End shift?" at LOCK, "Start shift?" after a PIN.
// Never throws.

async function signedIn(): Promise<{ error: string } | { userId: string }> {
  if (!(await isModuleEnabled(restaurantModule.id))) return { error: "The Restaurant module is turned off." };
  const { userId } = await getCurrentUserPermissions();
  return userId ? { userId } : { error: "You must be signed in to do that." };
}

// LOCK: `endShift` ends their shift first; with open tables they're handed
// to `transferTo` (refused with needsHandover until one is picked, Step 7a).
// On a PIN terminal the session ends (signedOut: the page goes to the PIN
// screen); elsewhere the screen locks.
export async function lockPos(input: unknown): Promise<ActionResult & { signedOut?: boolean; needsHandover?: Handover; transferred?: number }> {
  return safely("lock POS", async () => {
    const me = await signedIn();
    if ("error" in me) return { ok: false as const, error: me.error };
    const asked = typeof input === "object" && input !== null ? (input as { endShift?: unknown; transferTo?: unknown }) : {};
    const wantsEnd = asked.endShift === true;
    const transferTo = typeof asked.transferTo === "string" && asked.transferTo.length <= 191 ? asked.transferTo : null;
    const deviceId = await currentDeviceId();
    let transferred = 0;
    if (wantsEnd) {
      const ended = await endShift(me.userId, deviceId, new Date(), { transferTo });
      if (!ended.ok) return ended;
      transferred = ended.transferred;
      if (transferred) revalidatePath("/restaurant", "layout");
    }
    if (!(await pinTerminalId())) {
      if (wantsEnd) revalidatePath("/pos", "layout");
      return { ok: true as const, signedOut: false, transferred };
    }
    await signOut({ redirect: false });
    return { ok: true as const, signedOut: true, transferred };
  });
}

// "Start shift" after a PIN sign-in.
export async function startMyShift(): Promise<ActionResult & { started?: boolean }> {
  return safely("start shift", async () => {
    const me = await signedIn();
    if ("error" in me) return { ok: false as const, error: me.error };
    const result = await startShift(me.userId, await currentDeviceId());
    if (result.ok) revalidatePath("/pos", "layout");
    return result;
  });
}

// Settings › Staff (Administrator only): clock in / out on or off.
export async function saveClockInOut(on: unknown): Promise<ActionResult> {
  return safely("save clock in / out", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    if (typeof on !== "boolean") return { ok: false, error: "That setting can't be saved." };
    const result = await setClockInOut(on, admin.userId);
    revalidatePath("/settings/restaurant/staff");
    return result;
  });
}
