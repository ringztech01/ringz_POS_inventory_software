import "server-only";
import { cache } from "react";
import { Prisma, type BusinessSetting } from "@prisma/client";
import { prisma } from "@/lib/db";

// The id of the single BusinessSetting row.
export const BUSINESS_SETTINGS_ID = "default";

export type BusinessSettings = Pick<
  BusinessSetting,
  | "restaurantEnabled"
  | "restaurantReservedWindowMinutes"
  | "restaurantBookingGapMinutes"
  | "restaurantManualCleaning"
  | "restaurantServiceChargePercent"
  | "restaurantDiscountLimitPercent"
  | "restaurantWarehouseId"
  | "restaurantWasteApprovalLimit"
  | "restaurantWasteAmberPercent"
  | "restaurantWasteRedPercent"
>;

// The schema's defaults: what applies until the row is first saved.
const DEFAULTS: BusinessSettings = {
  restaurantEnabled: false,
  restaurantReservedWindowMinutes: 60,
  restaurantBookingGapMinutes: 120,
  restaurantManualCleaning: true,
  restaurantServiceChargePercent: new Prisma.Decimal(10),
  restaurantDiscountLimitPercent: new Prisma.Decimal(10),
  restaurantWarehouseId: null,
  restaurantWasteApprovalLimit: new Prisma.Decimal(0),
  restaurantWasteAmberPercent: new Prisma.Decimal(5),
  restaurantWasteRedPercent: new Prisma.Decimal(10),
};

// Read-only — never creates the row (the Settings page's save does).
// Memoised per request, so the sidebar, guards and pages share one query.
export const getBusinessSettings = cache(async (): Promise<BusinessSettings> => {
  const row = await prisma.businessSetting.findUnique({
    where: { id: BUSINESS_SETTINGS_ID },
    select: {
      restaurantEnabled: true,
      restaurantReservedWindowMinutes: true,
      restaurantBookingGapMinutes: true,
      restaurantManualCleaning: true,
      restaurantServiceChargePercent: true,
      restaurantDiscountLimitPercent: true,
      restaurantWarehouseId: true,
      restaurantWasteApprovalLimit: true,
      restaurantWasteAmberPercent: true,
      restaurantWasteRedPercent: true,
    },
  });
  return row ?? DEFAULTS;
});
