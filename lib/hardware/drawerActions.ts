"use server";

import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { drawerOpenSchema } from "@/lib/validations/drawer";
import { currentDeviceId } from "./device";
import { openDrawerByHand, type DrawerAnswer } from "./drawer";

export type { DrawerAnswer };

// Open drawer (the POS toolbar, the restaurant floor): this till's drawer,
// by hand — Open Drawer permission and a reason, both logged
// (DrawerEvent). Waits a few seconds to say whether it opened. Never throws.

export async function openCashDrawer(input: unknown): Promise<DrawerAnswer> {
  try {
    const auth = await requirePermission(PERMISSIONS.OPEN_DRAWER);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = drawerOpenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Say why you're opening the drawer." };
    return await openDrawerByHand({ note: parsed.data.reason, userId: auth.userId, deviceId: await currentDeviceId() });
  } catch (error) {
    console.error("[drawer] open by hand failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
