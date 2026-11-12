"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { signIn } from "@/auth";
import { createSwitchToken } from "@/lib/auth/posSwitch";
import { createRecoveryCode as createRecoveryCodeService } from "@/lib/auth/recovery";
import { currentDeviceId, DEVICE_ID } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import type { ActionResult } from "../../lib/actionResult";
import { staffBadge } from "../../lib/posSpeed";
import { restaurantModule } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requireAdministrator } from "../guard";
import { safely } from "../safely";
import { pinSignIn, setPinHideNames, setPinTerminal as setPinTerminalService, staffHomeOn } from "../services/pinSignIn";
import { shiftStatus } from "../services/shifts";

// PIN-only entry (Part 6f Step 4). signInByPin is the PIN screen's, used
// signed out — the device itself must be a paired terminal (checked on the
// server, with its lock-out). The rest are the Administrator's alone.
// Never throws.

// A PIN — or a staff card read by the scanner (Step 7d).
const pinInputSchema = z.union([
  z.object({ userId: idSchema.nullable().optional(), pin: z.string().regex(/^\d{4,6}$/) }),
  z.object({ card: z.string().min(1).max(200) }),
]);

// askShift: clock in / out is on and they aren't on shift — "Start shift?".
export type PinSignInAnswer = { ok: true; name: string; initials: string; home: string; askShift: boolean } | { ok: false; error: string; waitSeconds?: number };

export async function signInByPin(input: unknown): Promise<PinSignInAnswer> {
  return safely("sign in by PIN", async (): Promise<PinSignInAnswer> => {
    if (!(await isModuleEnabled(restaurantModule.id))) return { ok: false, error: "The Restaurant module is turned off." };
    const deviceId = await currentDeviceId();
    if (!deviceId) return { ok: false, error: "This device isn't a PIN terminal. Sign in with your email instead." };
    const parsed = pinInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "A PIN is 4 digits." };

    const result = await pinSignIn("card" in parsed.data ? { deviceId, userId: null, pin: "", card: parsed.data.card } : { deviceId, userId: parsed.data.userId ?? null, pin: parsed.data.pin });
    if (!result.ok) return result;

    const token = createSwitchToken(result.user.id);
    if (!token) return { ok: false, error: "Signing in by PIN needs NEXTAUTH_SECRET in .env." };
    try {
      const url = await signIn("pos-switch", { token, redirect: false });
      if (typeof url === "string" && url.includes("error=")) return { ok: false, error: "Couldn't sign in. Try again." };
    } catch {
      return { ok: false, error: "Couldn't sign in. Try again." };
    }
    const [home, shift] = await Promise.all([staffHomeOn(result.user.id, deviceId), shiftStatus(result.user.id)]);
    return { ok: true, name: result.user.firstName, initials: staffBadge(result.user.name).initials, home, askShift: shift.askStart };
  });
}

const terminalSchema = z.object({ deviceId: z.string().regex(DEVICE_ID), on: z.boolean(), kind: z.enum(["POS", "KITCHEN", "BAR"]).optional(), areaId: z.string().min(1).max(191).nullable().optional() });

// Settings › Devices: this device is (or isn't) a restaurant PIN terminal.
export async function setPinTerminal(input: unknown): Promise<ActionResult> {
  return safely("set PIN terminal", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = terminalSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That device isn't known." };
    const result = await setPinTerminalService(parsed.data, admin.userId);
    if (result.ok) revalidatePath("/settings/devices");
    return result;
  });
}

// Settings › Staff: hide the "on shift" names on the PIN screen.
export async function savePinHideNames(hide: unknown): Promise<ActionResult> {
  return safely("save PIN screen names", async (): Promise<ActionResult> => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    if (typeof hide !== "boolean") return { ok: false, error: "That setting can't be saved." };
    const result = await setPinHideNames(hide, admin.userId);
    revalidatePath("/settings/restaurant/staff");
    return result;
  });
}

// Settings › Staff: a new recovery code (the old one stops working). Sent
// back once, to show, print or save — never again.
export async function makeRecoveryCode(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  return safely("make recovery code", async () => {
    const admin = await requireAdministrator();
    if (admin.error !== undefined) return { ok: false as const, error: admin.error };
    const code = await createRecoveryCodeService(admin.userId);
    revalidatePath("/settings/restaurant/staff");
    return { ok: true as const, code };
  });
}
