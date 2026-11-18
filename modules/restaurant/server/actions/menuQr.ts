"use server";

import { revalidatePath } from "next/cache";
import { parseMenuAddress } from "../../lib/menuAddress";
import { menuAddressSchema, menuDesignSchema, menuWifiSchema, newQrPointSchema, qrTargetSchema, renameQrPointSchema } from "../../schemas/menuQr";
import { idSchema } from "../../schemas/common";
import { requireMenuQr } from "../guard";
import { safely } from "../safely";
import { addQrPoint, removeQrPoint, renameQrPoint, rotateQr, saveMenuAddress, saveMenuDesign, saveMenuWifi } from "../services/menuQr";

// Digital menu › QR codes (Part 8 Step 2). The Administrator or Manage Floor
// Plan (requireMenuQr), checked before anything is read.

export type MenuQrAnswer = { ok: true } | { ok: false; error: string };

const PAGE = "/restaurant/digital-menu/qr-codes";
const done = (): MenuQrAnswer => {
  revalidatePath(PAGE);
  return { ok: true };
};
const BAD = { ok: false as const, error: "Something in that wasn't right. Please try again." };

export async function saveMenuAddressAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("save menu address", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = menuAddressSchema.safeParse(input);
    if (!parsed.success) return BAD;
    const address = parseMenuAddress(parsed.data.address);
    if (!address.ok) return address;
    await saveMenuAddress(address.url, auth.userId);
    return done();
  });
}

export async function saveMenuDesignAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("save menu design", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = menuDesignSchema.safeParse(input);
    if (!parsed.success) return BAD;
    await saveMenuDesign(parsed.data.design, auth.userId);
    return done();
  });
}

export async function saveMenuWifiAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("save menu Wi-Fi", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = menuWifiSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? BAD.error };
    await saveMenuWifi(parsed.data.name, parsed.data.password, auth.userId);
    return done();
  });
}

export async function rotateMenuQrAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("rotate menu QR", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = qrTargetSchema.safeParse(input);
    if (!parsed.success) return BAD;
    const result = await rotateQr(parsed.data.kind, parsed.data.id, auth.userId);
    return result.ok ? done() : result;
  });
}

export async function addQrPointAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("add QR point", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = newQrPointSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? BAD.error };
    const result = await addQrPoint(parsed.data, auth.userId);
    return result.ok ? done() : { ok: false, error: result.error };
  });
}

export async function renameQrPointAction(input: unknown): Promise<MenuQrAnswer> {
  return safely("rename QR point", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = renameQrPointSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? BAD.error };
    const result = await renameQrPoint(parsed.data.id, parsed.data.name, auth.userId);
    return result.ok ? done() : result;
  });
}

export async function removeQrPointAction(id: unknown): Promise<MenuQrAnswer> {
  return safely("remove QR point", async (): Promise<MenuQrAnswer> => {
    const auth = await requireMenuQr();
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return BAD;
    const result = await removeQrPoint(parsed.data, auth.userId);
    return result.ok ? done() : result;
  });
}
