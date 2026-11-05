"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { currentDeviceId, DEVICE_COOKIE } from "./device";

// The device beacon (components/hardware/DeviceBeacon.tsx): gives this
// browser its device id cookie if it has none, and notes it as seen (at most
// every 5 minutes). Signed-in users only. Never throws.

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
const SEEN_EVERY_MS = 5 * 60 * 1000;

export async function registerDevice(): Promise<{ ok: true; deviceId: string } | { ok: false }> {
  try {
    if (!(await getCurrentUserPermissions()).userId) return { ok: false };
    let deviceId = await currentDeviceId();
    if (!deviceId) {
      deviceId = randomUUID();
      (await cookies()).set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: TEN_YEARS, secure: process.env.NODE_ENV === "production" });
    }
    const userAgent = ((await headers()).get("user-agent") ?? "").slice(0, 255) || null;
    const now = new Date();
    const known = await prisma.device.findUnique({ where: { id: deviceId }, select: { lastSeenAt: true } });
    if (!known) await prisma.device.create({ data: { id: deviceId, userAgent, lastSeenAt: now } });
    else if (now.getTime() - known.lastSeenAt.getTime() > SEEN_EVERY_MS) await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: now, userAgent } });
    return { ok: true, deviceId };
  } catch (error) {
    console.error("[device] register failed:", error);
    return { ok: false };
  }
}
