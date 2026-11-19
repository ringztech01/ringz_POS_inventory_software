import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { APP_TIME_ZONE } from "@/lib/dateRanges";
import { currentDeviceId } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { PERMISSIONS } from "@/lib/permissions";
import ForbiddenState from "@/components/ui/ForbiddenState";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";
import DevicesPanel from "@/components/settings/devices/DevicesPanel";
import { restaurantModule } from "@/modules/restaurant/manifest";
import { browserOf } from "@/lib/hardware/deviceLabel";
import { detectedKind } from "@/modules/restaurant/lib/tabletDevice";

const seen = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });


// /settings/devices — Settings › Devices: every browser that has opened the
// POS, the kitchen display, an order or Settings (a long-lived cookie), its
// name and when it was last seen; with the Restaurant module on, which view
// it uses (Part 6f: the business's, or its own — a bar PC kept on Classic).
// An Administrator also pairs a device as a restaurant PIN terminal (Step 4).
// Needs Manage Setting.
export default async function DevicesPage() {
  const current = await getCurrentUserPermissions();
  const { permissions } = current;
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  const [devices, thisDeviceId, restaurant, business] = await Promise.all([
    prisma.device.findMany({ orderBy: [{ lastSeenAt: "desc" }], take: 200, select: { id: true, name: true, userAgent: true, lastSeenAt: true, restaurantInterface: true, pinLogin: true, terminalRole: true, homeAreaId: true, screen: true, touchScreen: true } }),
    currentDeviceId(),
    isModuleEnabled(restaurantModule.id),
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }),
  ]);
  return (
    <>
      <DeviceBeacon />
      <DevicesPanel
        devices={devices.map((d) => ({ id: d.id, name: d.name, browser: browserOf(d.userAgent), lastSeen: seen.format(d.lastSeenAt), view: d.restaurantInterface, terminal: d.pinLogin ? d.terminalRole : null, areaId: d.homeAreaId, screen: d.screen, detected: detectedKind(d.userAgent, d.touchScreen) }))}
        thisDeviceId={thisDeviceId}
        restaurant={restaurant ? { businessView: business?.restaurantInterface ?? "SERVICE", canPair: await isSystemAdmin(current), areas: await prisma.diningArea.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) } : null}
      />
    </>
  );
}
