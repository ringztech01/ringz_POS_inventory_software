import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import type { ActionResult } from "../../lib/actionResult";
import type { PaymentSettingsInput } from "../../schemas/pos";

// Settings › Restaurant › Payments: whether the tablet's PAY asks for a tip
// (off until it's switched on). The desktop Payment pop-up always has its
// own Tip field; this is the tablet's step only.
export type PaymentSettings = { tabletTips: boolean };

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const row = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantTabletTips: true } });
  return { tabletTips: row?.restaurantTabletTips ?? false };
}

export async function setPaymentSettings(input: PaymentSettingsInput): Promise<ActionResult> {
  const data = { restaurantTabletTips: input.tabletTips };
  await prisma.businessSetting.upsert({ where: { id: BUSINESS_SETTINGS_ID }, create: { id: BUSINESS_SETTINGS_ID, ...data }, update: data });
  return { ok: true };
}
