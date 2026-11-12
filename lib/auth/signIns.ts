import "server-only";
import { prisma } from "@/lib/db";
import { currentDeviceId } from "@/lib/hardware/device";
import { writeAudit } from "@/lib/audit";

// A sign-in (email and password, or a PIN on the POS): when, and on which
// device (Settings › Staff shows both, Part 6f). Never stops the sign-in.
// `method` "password": logged as a sign-in too (the audit view, Step 7e) — a
// PIN, a card or a recovery code are logged where they're checked.
export async function noteSignIn(userId: string, method: "password" | null = null): Promise<void> {
  try {
    const deviceId = await currentDeviceId().catch(() => null);
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), ...(deviceId ? { lastDeviceId: deviceId } : {}) } });
    if (method) await writeAudit({ userId, action: "auth.signin", entityType: "Device", entityId: deviceId, meta: { method } });
  } catch (error) {
    console.warn("[auth] couldn't note a sign-in:", error);
  }
}
