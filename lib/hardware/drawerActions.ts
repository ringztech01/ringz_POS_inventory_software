"use server";

import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { drawerOpenSchema } from "@/lib/validations/drawer";
import { currentDeviceId } from "./device";
import { openDrawer } from "./drawer";
import { waitForJob } from "./printQueue";

// Open drawer (the POS toolbar, the restaurant floor): this till's drawer,
// by hand — Open Drawer permission and a reason, both logged
// (DrawerEvent). Waits a few seconds to say whether it opened. Never throws.

export type DrawerAnswer = { ok: true; opened: boolean; message: string } | { ok: false; error: string };

const WAIT_MS = 8000;
const plain = (error: string | null) => (error ?? "").replace(/^Try \d of \d failed: /, "").replace(/\.\s*$/, "");

export async function openCashDrawer(input: unknown): Promise<DrawerAnswer> {
  try {
    const auth = await requirePermission(PERMISSIONS.OPEN_DRAWER);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = drawerOpenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Say why you're opening the drawer." };
    const opened = await openDrawer({ reason: "MANUAL", note: parsed.data.reason, userId: auth.userId, deviceId: await currentDeviceId() });
    if (!opened.sent) return { ok: false, error: "This till has no cash drawer — an admin sets one up in Settings › Printers." };
    const done = await waitForJob(opened.jobId, WAIT_MS);
    if (done.status === "DONE") return { ok: true, opened: true, message: "Drawer opened." };
    if (done.status === "FAILED" || done.status === "CANCELLED") return { ok: false, error: `The drawer didn't open: ${plain(done.error) || "the printer didn't answer"}.` };
    return { ok: true, opened: false, message: `Waiting for ${opened.printer} — the drawer opens if it answers within 30 seconds.` };
  } catch (error) {
    console.error("[drawer] open by hand failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
