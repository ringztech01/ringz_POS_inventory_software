import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";

// Restaurant Reports' settings: when the business day starts (0: midnight),
// and the cash variance limit (Shifts & cash-up).

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

export async function getReportSettings(): Promise<{ dayStartMinutes: number; varianceLimit: string }> {
  const row = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantDayStartMinutes: true, restaurantCashVarianceLimit: true } });
  return { dayStartMinutes: row?.restaurantDayStartMinutes ?? 0, varianceLimit: row?.restaurantCashVarianceLimit.toFixed(2) ?? "500.00" };
}

export async function setReportSettings(input: { minutes: number; varianceLimit: string }): Promise<void> {
  const data = { restaurantDayStartMinutes: input.minutes, restaurantCashVarianceLimit: input.varianceLimit };
  await prisma.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, ...data }, update: data });
}
