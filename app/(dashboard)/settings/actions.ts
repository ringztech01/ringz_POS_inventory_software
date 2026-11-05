"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { MODULES } from "@/lib/modules/registry";

export type ModuleToggleState = { ok: true } | { ok: false; error: string };

// Switches an optional module on or off for the whole business. Needs that
// module's settings permission (e.g. Restaurant Settings), checked here —
// the page only hides the switch. Creates the settings row on first save.
export async function setModuleEnabled(moduleId: unknown, enabled: unknown): Promise<ModuleToggleState> {
  const mod = MODULES.find((item) => item.id === moduleId);
  if (!mod || typeof enabled !== "boolean") {
    return { ok: false, error: "Unknown module." };
  }

  const authCheck = await requirePermission(mod.toggle.permission);
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const data = { [mod.toggle.setting]: enabled };
  await prisma.businessSetting.upsert({
    where: { id: BUSINESS_SETTINGS_ID },
    create: { id: BUSINESS_SETTINGS_ID, ...data },
    update: data,
  });

  // The sidebar (every page) and the module's routes depend on it.
  revalidatePath("/", "layout");
  return { ok: true };
}
