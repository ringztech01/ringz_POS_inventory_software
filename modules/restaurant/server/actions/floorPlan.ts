"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserPermissions, isSystemAdmin } from "@/lib/auth/permissions.server";
import type { ActionResult } from "../../lib/actionResult";
import {
  floorImageAdjustSchema,
  floorImageAreaSchema,
  floorLayoutDeleteSchema,
  floorLayoutSaveSchema,
  floorLayoutSwitchSchema,
  floorLockSchema,
  floorReachSchema,
  saveFloorPlanSchema,
} from "../../schemas/floorPlan";
import { deleteFloorLayout, saveFloorLayout, switchFloorLayout } from "../services/floorLayouts";
import { floorReach } from "../floorPresence";
import { requireFloorPlan } from "../guard";
import { safely } from "../safely";
import { saveFloorPlan as saveFloorPlanService, setFloorLock, type FloorSaveResult } from "../services/floorPlan";
import { adjustFloorImage, removeFloorImage, storeFloorImage, type FloorBackground } from "../services/floorImage";

// The floor plan editor's actions (Part 7). Each: the module on, signed in,
// Manage Floor Plan (requireFloorPlan — refused here, not only hidden).
// Never throws.

const refresh = () => {
  revalidatePath("/restaurant", "layout");
  revalidatePath("/pos", "layout");
};

export async function saveFloorPlan(input: unknown): Promise<FloorSaveResult> {
  return safely("save floor plan", async (): Promise<FloorSaveResult> => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = saveFloorPlanSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That floor plan can't be saved." };
    const result = await saveFloorPlanService(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

// "Saved v13 · N tablets updated": of the service screens showing the floor
// right now, how many have drawn the saved versions (server/floorPresence).
export async function getFloorReach(input: unknown): Promise<{ ok: true; showing: number; updated: number } | { ok: false; error: string }> {
  return safely("floor reach", async () => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const parsed = floorReachSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: "Nothing to check." };
    return { ok: true as const, ...floorReach(parsed.data.versions) };
  });
}

export async function setFloorPlanLock(input: unknown): Promise<ActionResult> {
  return safely("lock floor plan", async (): Promise<ActionResult> => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = floorLockSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That area can't be found." };
    const result = await setFloorLock(parsed.data.areaId, parsed.data.locked);
    if (result.ok) refresh();
    return result;
  });
}

// ---- The floor plan image (Step 3): Administrator only ----
// Checked here on the server, not only by hiding the buttons: Manage Floor
// Plan first (as every floor plan action), then the built-in system admin
// role (isSystemAdmin — the one place that rule lives). Managers can move
// tables but get this refusal for the image.
const ADMIN_ONLY = "Only an Administrator can upload or change the floor plan image.";
async function requireImageAdmin(): Promise<{ error: string; userId?: undefined } | { error?: undefined; userId: string }> {
  const authCheck = await requireFloorPlan();
  if (authCheck.error !== undefined) return authCheck;
  if (!(await isSystemAdmin(await getCurrentUserPermissions()))) return { error: ADMIN_ONLY };
  return { userId: authCheck.userId };
}
const refreshEditor = () => revalidatePath("/restaurant/settings/floor");

type ImageResult = { ok: true; background: FloorBackground; replaced?: boolean } | { ok: false; error: string };

// FormData: areaId, file (PNG, JPG or WebP, 8 MB at most).
export async function uploadFloorBackground(formData: FormData): Promise<ImageResult> {
  return safely("upload floor plan image", async (): Promise<ImageResult> => {
    const admin = await requireImageAdmin();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = floorImageAreaSchema.safeParse({ areaId: formData.get("areaId") });
    if (!parsed.success) return { ok: false, error: "That area can't be found." };
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image to upload." };
    const result = await storeFloorImage({
      areaId: parsed.data.areaId,
      userId: admin.userId,
      file: { name: file.name, type: file.type, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) },
    });
    if (result.ok) refreshEditor();
    return result;
  });
}

export async function removeFloorBackground(input: unknown): Promise<ActionResult> {
  return safely("remove floor plan image", async (): Promise<ActionResult> => {
    const admin = await requireImageAdmin();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = floorImageAreaSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That area can't be found." };
    const result = await removeFloorImage({ areaId: parsed.data.areaId, userId: admin.userId });
    if (result.ok) refreshEditor();
    return result.ok ? { ok: true } : result;
  });
}

// Opacity while tracing, and/or calibration (scale + offset, or null).
export async function adjustFloorBackground(input: unknown): Promise<ImageResult> {
  return safely("adjust floor plan image", async (): Promise<ImageResult> => {
    const admin = await requireImageAdmin();
    if (admin.error !== undefined) return { ok: false, error: admin.error };
    const parsed = floorImageAdjustSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That change can't be saved." };
    const result = await adjustFloorImage({ ...parsed.data, userId: admin.userId });
    if (result.ok) refreshEditor();
    return result;
  });
}

// ---- Event layouts (Step 5): Manage Floor Plan ----

export async function saveFloorPlanLayout(input: unknown): Promise<{ ok: true; layoutId: string; replaced: boolean } | { ok: false; error: string; exists?: boolean }> {
  return safely("save floor layout", async () => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false as const, error: authCheck.error };
    const parsed = floorLayoutSaveSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "That layout can't be saved." };
    const result = await saveFloorLayout(parsed.data, authCheck.userId);
    if (result.ok) revalidatePath("/restaurant/settings/floor");
    return result;
  });
}

// layoutId: a saved layout, or null for Restore normal.
export async function switchFloorPlanLayout(input: unknown): Promise<FloorSaveResult & { name?: string }> {
  return safely("switch floor layout", async (): Promise<FloorSaveResult & { name?: string }> => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = floorLayoutSwitchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That layout can't be found." };
    const result = await switchFloorLayout(parsed.data, authCheck.userId);
    if (result.ok) refresh();
    return result;
  });
}

export async function deleteFloorPlanLayout(input: unknown): Promise<ActionResult> {
  return safely("delete floor layout", async (): Promise<ActionResult> => {
    const authCheck = await requireFloorPlan();
    if (authCheck.error !== undefined) return { ok: false, error: authCheck.error };
    const parsed = floorLayoutDeleteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That layout can't be found." };
    const result = await deleteFloorLayout(parsed.data, authCheck.userId);
    if (result.ok) revalidatePath("/restaurant/settings/floor");
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
}
