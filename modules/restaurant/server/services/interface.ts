import "server-only";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { DEFAULT_VIEW, type RestaurantView } from "../../lib/serviceRoutes";
import type { DeviceInterfaceInput } from "../../schemas/interface";

// Part 6f Step 1: the restaurant's view, for the business and per device.
// Each change goes in the audit log. Open orders aren't touched — the view
// only decides which screens show them.

export type InterfaceSettings = {
  view: RestaurantView;
  // This browser, if it's a known device, and its own view (null: the business's).
  thisDevice: { id: string; name: string | null; view: RestaurantView | null } | null;
  // Devices keeping their own view.
  overrides: { service: number; classic: number };
};

export async function getInterfaceSettings(deviceId: string | null): Promise<InterfaceSettings> {
  const [business, device, counts] = await Promise.all([
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }),
    deviceId ? prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, restaurantInterface: true } }) : null,
    prisma.device.groupBy({ by: ["restaurantInterface"], where: { restaurantInterface: { not: null } }, _count: true }),
  ]);
  const count = (view: RestaurantView) => counts.find((c) => c.restaurantInterface === view)?._count ?? 0;
  return {
    view: business?.restaurantInterface ?? DEFAULT_VIEW,
    thisDevice: device ? { id: device.id, name: device.name, view: device.restaurantInterface } : null,
    overrides: { service: count("SERVICE"), classic: count("CLASSIC") },
  };
}

export async function setRestaurantInterface(view: RestaurantView, userId: string): Promise<{ ok: true; changed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const before = (await tx.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }))?.restaurantInterface ?? DEFAULT_VIEW;
    await tx.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, restaurantInterface: view }, update: { restaurantInterface: view } });
    if (before !== view) await writeAudit({ userId, action: "restaurant.interface.set", entityType: "BusinessSetting", entityId: BUSINESS_SETTINGS_ID, meta: { from: before, to: view } }, tx);
    return { ok: true as const, changed: before !== view };
  });
}

export async function setDeviceInterface(input: DeviceInterfaceInput, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return prisma.$transaction(async (tx) => {
    const device = await tx.device.findUnique({ where: { id: input.deviceId }, select: { name: true, restaurantInterface: true } });
    if (!device) return { ok: false as const, error: "That device is no longer listed — refreshed." };
    await tx.device.update({ where: { id: input.deviceId }, data: { restaurantInterface: input.view } });
    if (device.restaurantInterface !== input.view)
      await writeAudit(
        { userId, action: "device.interface.set", entityType: "Device", entityId: input.deviceId, meta: { device: device.name, from: device.restaurantInterface ?? "BUSINESS", to: input.view ?? "BUSINESS" } },
        tx,
      );
    return { ok: true as const };
  });
}
