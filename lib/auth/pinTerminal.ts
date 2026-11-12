import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { currentDeviceId } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";

// Is this browser a restaurant PIN terminal (Part 6f Step 4)? An
// Administrator pairs a device on Settings › Devices; from then on it opens
// on the PIN screen and never takes an email, password or recovery code —
// the sign-in providers ask this too. Only while the Restaurant module is on
// (off, retail is unchanged). A failed look-up counts as "no".
export const pinTerminalId = cache(async (): Promise<string | null> => {
  try {
    const deviceId = await currentDeviceId();
    if (!deviceId || !(await isModuleEnabled("restaurant"))) return null;
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { pinLogin: true } });
    return device?.pinLogin ? deviceId : null;
  } catch (error) {
    console.warn("[auth] couldn't tell whether this is a PIN terminal:", error);
    return null;
  }
});
