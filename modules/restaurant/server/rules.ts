import "server-only";
import { getBusinessSettings } from "@/lib/business-settings";
import type { TableStatusRules } from "../lib/tableStatus";

// The restaurant rules from BusinessSetting, in tableStatus's shape.
export async function getTableStatusRules(): Promise<TableStatusRules> {
  const settings = await getBusinessSettings();
  return {
    reservedWindowMinutes: settings.restaurantReservedWindowMinutes,
    manualCleaning: settings.restaurantManualCleaning,
  };
}
