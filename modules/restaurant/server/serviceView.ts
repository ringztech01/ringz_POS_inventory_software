import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { currentDeviceId } from "@/lib/hardware/device";
import { resolveView, routesFor, type RestaurantView, type ServiceRoutes } from "../lib/serviceRoutes";
import { isTabletRequest } from "./tabletDevice";

// This request's restaurant view (Part 6f Step 1): the device's own
// (Settings › Devices) or the business's (Settings › Restaurant ›
// Interface). Read on every screen load, so a change shows on the next one.
// Memoised per request.
export const getServiceView = cache(async (): Promise<RestaurantView> => {
  const deviceId = await currentDeviceId();
  const [business, device] = await Promise.all([
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }),
    deviceId ? prisma.device.findUnique({ where: { id: deviceId }, select: { restaurantInterface: true } }) : null,
  ]);
  return resolveView(business, device);
});

// The routes for this request's device: on a Tablet in the Service view,
// the tablet screens (Part 6g).
export async function getServiceRoutes(): Promise<ServiceRoutes> {
  const [view, tablet] = await Promise.all([getServiceView(), isTabletRequest()]);
  return routesFor(view, { tablet });
}
