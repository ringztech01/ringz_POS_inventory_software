import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";

// When the business day starts, for Restaurant Reports (0: midnight).

export async function getDayStartMinutes(): Promise<number> {
  const row = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantDayStartMinutes: true } });
  return row?.restaurantDayStartMinutes ?? 0;
}

export async function setDayStartMinutes(minutes: number): Promise<void> {
  await prisma.businessSetting.upsert({
    where: { id: BUSINESS_SETTINGS_ID },
    create: { id: BUSINESS_SETTINGS_ID, restaurantDayStartMinutes: minutes },
    update: { restaurantDayStartMinutes: minutes },
  });
}
