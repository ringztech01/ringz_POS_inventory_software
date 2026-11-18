"use server";

import { z } from "zod";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";
import { getMenuMedia, removeMenuMedia, setMenuMediaType, type MediaResult } from "../services/menuMedia";

// Food › Menu items › Media (Part 8 Step 5): load an item's media, remove
// some, or choose what the menu shows. Needs Manage Food. (Uploads go
// through POST /restaurant/food/media/…: files are too big for an action.)

const BAD = { ok: false as const, error: "Something in that wasn't right. Please try again." };

export async function getMenuMediaAction(productId: unknown): Promise<MediaResult> {
  return safely("load menu media", async (): Promise<MediaResult> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const id = idSchema.safeParse(productId);
    if (!id.success) return BAD;
    const media = await getMenuMedia(id.data);
    return media ? { ok: true, media } : { ok: false, error: "That menu item has been deleted. Reload the list." };
  });
}

export async function removeMenuMediaAction(input: unknown): Promise<MediaResult> {
  return safely("remove menu media", async (): Promise<MediaResult> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = z.object({ productId: idSchema, kind: z.enum(["photo", "spin", "model", "usdz"]) }).safeParse(input);
    if (!parsed.success) return BAD;
    return removeMenuMedia(parsed.data.productId, parsed.data.kind, auth.userId);
  });
}

export async function setMenuMediaTypeAction(input: unknown): Promise<MediaResult> {
  return safely("choose menu media", async (): Promise<MediaResult> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = z.object({ productId: idSchema, type: z.enum(["PHOTO", "SPIN", "MODEL"]) }).safeParse(input);
    if (!parsed.success) return BAD;
    return setMenuMediaType(parsed.data.productId, parsed.data.type, auth.userId);
  });
}
