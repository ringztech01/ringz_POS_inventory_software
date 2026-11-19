import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { currentDeviceId } from "@/lib/hardware/device";
import { deviceKind } from "../lib/tabletDevice";

// Whether a device is a Tablet (Part 6g): its Screen setting (Settings ›
// Devices), else — on Auto — its browser: the one asking now, or the one it
// last reported. A browser that isn't a known device yet goes by its user
// agent alone. Never throws: a failed look-up is a desktop.
export async function deviceIsTablet(deviceId: string | null, userAgent: string | null): Promise<boolean> {
  try {
    const device = deviceId ? await prisma.device.findUnique({ where: { id: deviceId }, select: { screen: true, touchScreen: true, userAgent: true } }) : null;
    return deviceKind(device?.screen, userAgent ?? device?.userAgent, device?.touchScreen ?? false) === "TABLET";
  } catch (error) {
    console.warn("[tablet] couldn't read the device:", error);
    return false;
  }
}

// This request's, memoised per request.
export const isTabletRequest = cache(async (): Promise<boolean> => deviceIsTablet(await currentDeviceId(), (await headers()).get("user-agent")));
