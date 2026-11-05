import "server-only";
import { cache } from "react";
import { getBusinessSettings } from "@/lib/business-settings";
import { MODULES } from "./registry";

// Ids of the modules switched on in Settings. Memoised per request.
export const getEnabledModuleIds = cache(async (): Promise<string[]> => {
  const settings = await getBusinessSettings();
  return MODULES.filter((mod) => mod.isEnabled(settings)).map((mod) => mod.id);
});

export async function isModuleEnabled(id: string): Promise<boolean> {
  return (await getEnabledModuleIds()).includes(id);
}
