import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { requireRestaurant } from "../server/guard";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { recoveryCodeMadeAt } from "@/lib/auth/recovery";
import { APP_TIME_ZONE } from "@/lib/dateRanges";
import { getStaffPage } from "../server/services/staff";
import StaffPanel from "../components/settings/StaffPanel";

// /settings/restaurant/staff — Settings › Staff (Part 6f Step 3): everyone
// who uses the app, their PINs, disabling. Administrator only (the built-in
// role, not a permission); a 404 while the module is off. Step 4 adds the
// PIN screen's names setting and the recovery code.
export default async function StaffPage() {
  await requireRestaurant();
  if (!(await isSystemAdmin(await getCurrentUserPermissions()))) return <ForbiddenState permission="Administrator role" />;
  const [data, setting, recoveryAt] = await Promise.all([
    getStaffPage(),
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantPinHideNames: true, restaurantClockInOut: true } }),
    recoveryCodeMadeAt(),
  ]);
  const made = recoveryAt ? new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(recoveryAt) : null;
  return <StaffPanel data={data} pinScreen={{ hideNames: setting?.restaurantPinHideNames ?? false, clockInOut: setting?.restaurantClockInOut ?? false, recoveryMadeAt: made }} />;
}
