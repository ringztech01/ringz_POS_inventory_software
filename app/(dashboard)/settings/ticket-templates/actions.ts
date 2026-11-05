"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH, rowBytes } from "@/lib/hardware/raster";
import { QR_TEXT_MAX, TEMPLATE_LINES_MAX, TEMPLATE_TEXT_MAX } from "@/lib/hardware/ticketLimits";
import { forgetTicketLook } from "@/lib/hardware/ticketLook";

// Settings › Ticket templates: the look of every printed ticket. Manage
// Setting; parsed with zod; the print worker picks it up at once.

type Result = { ok: true } | { ok: false; error: string };

const lines = (label: string) =>
  z
    .string()
    .max(TEMPLATE_TEXT_MAX, `Keep the ${label} to ${TEMPLATE_TEXT_MAX} characters.`)
    .refine((v) => v.split(/\r?\n/).filter((l) => l.trim()).length <= TEMPLATE_LINES_MAX, `Keep the ${label} to ${TEMPLATE_LINES_MAX} lines.`);

const settingsSchema = z
  .object({
    logo: z.boolean(),
    header: lines("header"),
    footer: lines("footer"),
    kitchenLarge: z.boolean(),
    kotPrices: z.boolean(),
    qr: z.boolean(),
    qrText: z.string().trim().max(QR_TEXT_MAX, `Keep the QR code's text to ${QR_TEXT_MAX} characters.`),
  })
  .refine((v) => !v.qr || v.qrText.length > 0, { message: "Say what the QR code should hold (a link, for example), or switch it off.", path: ["qrText"] });

const logoSchema = z
  .object({ width: z.number().int().min(8).max(LOGO_MAX_WIDTH), height: z.number().int().min(1).max(LOGO_MAX_HEIGHT), data: z.string().max(200_000) })
  .refine((v) => Buffer.from(v.data, "base64").length === rowBytes(v.width) * v.height, { message: "That logo didn't come through whole — try again." });

async function guarded(label: string, body: () => Promise<Result>): Promise<Result> {
  try {
    const auth = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const result = await body();
    if (result.ok) {
      forgetTicketLook();
      revalidatePath("/settings/ticket-templates");
    }
    return result;
  } catch (error) {
    console.error(`[print] ${label} failed:`, error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// The settings row exists (created on first save), then the change.
const save = (data: Prisma.BusinessSettingUpdateInput) =>
  prisma.$transaction(async (tx) => {
    await tx.businessSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
    await tx.businessSetting.update({ where: { id: "default" }, data });
  });

export async function saveTicketSettings(input: unknown): Promise<Result> {
  return guarded("save ticket settings", async () => {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Those settings aren't valid." };
    const v = parsed.data;
    await save({
      printLogo: v.logo,
      printHeader: v.header.trim() || null,
      printFooter: v.footer.trim() || null,
      printKitchenLarge: v.kitchenLarge,
      printKotPrices: v.kotPrices,
      printQr: v.qr,
      printQrText: v.qrText || null,
    });
    return { ok: true };
  });
}

// The logo, already 1-bit (turned in the browser): kept, and switched on.
export async function saveLogo(input: unknown): Promise<Result> {
  return guarded("save logo", async () => {
    const parsed = logoSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That logo isn't valid." };
    const { width, height, data } = parsed.data;
    await save({ printLogo: true, printLogoWidth: width, printLogoHeight: height, printLogoData: Buffer.from(data, "base64") });
    return { ok: true };
  });
}

export async function removeLogo(): Promise<Result> {
  return guarded("remove logo", async () => {
    await save({ printLogo: false, printLogoWidth: null, printLogoHeight: null, printLogoData: null });
    return { ok: true };
  });
}
