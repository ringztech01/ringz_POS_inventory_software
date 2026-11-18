import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { writeAudit } from "@/lib/audit";
import { newQrToken } from "../../lib/qrToken";
import { replaceQrToken } from "./tables";

// Digital menu › QR codes (Part 8 Step 2): the menu's address and Wi-Fi,
// rotating a code, and the QR points. The actions check who's asking; these
// do the work and log it (AuditLog).

export type ServiceResult = { ok: true } | { ok: false; error: string };

// The business's menu settings row (made by the add_digital_menu migration;
// made here too, should it be missing).
export function menuSettings() {
  return prisma.menuSettings.upsert({ where: { businessId: BUSINESS_SETTINGS_ID }, create: { businessId: BUSINESS_SETTINGS_ID }, update: {} });
}

export async function saveMenuAddress(url: string, userId: string): Promise<ServiceResult> {
  const before = await menuSettings();
  await prisma.menuSettings.update({ where: { id: before.id }, data: { menuBaseUrl: url } });
  if (before.menuBaseUrl !== url) await writeAudit({ userId, action: "menu.address.update", entityType: "MenuSettings", entityId: before.id, meta: { from: before.menuBaseUrl, to: url } });
  return { ok: true };
}

// The guest menu's look (Showcase or Classic): every menu switches at its
// next load.
export async function saveMenuDesign(design: "SHOWCASE" | "CLASSIC", userId: string): Promise<ServiceResult> {
  const before = await menuSettings();
  await prisma.menuSettings.update({ where: { id: before.id }, data: { menuDesign: design } });
  if (before.menuDesign !== design) await writeAudit({ userId, action: "menu.design.update", entityType: "MenuSettings", entityId: before.id, meta: { from: before.menuDesign, to: design } });
  return { ok: true };
}

export async function saveMenuWifi(name: string, password: string, userId: string): Promise<ServiceResult> {
  const before = await menuSettings();
  const wifiName = name.trim() || null;
  // No network name: no password either (nothing to join).
  const wifiPassword = wifiName && password ? password : null;
  await prisma.menuSettings.update({ where: { id: before.id }, data: { wifiName, wifiPassword } });
  // The password itself isn't logged.
  if (before.wifiName !== wifiName || before.wifiPassword !== wifiPassword) {
    await writeAudit({ userId, action: "menu.wifi.update", entityType: "MenuSettings", entityId: before.id, meta: { name: wifiName, passwordChanged: before.wifiPassword !== wifiPassword } });
  }
  return { ok: true };
}

const GONE = { ok: false as const, error: "That QR code can't be found. It may have been removed." };

// A new token: the old printed code stops working at once.
export async function rotateQr(kind: "table" | "point", id: string, userId: string): Promise<ServiceResult> {
  if (kind === "table") {
    if (!(await replaceQrToken(id))) return GONE;
  } else {
    const { count } = await prisma.qrPoint.updateMany({ where: { id, deletedAt: null }, data: { qrToken: newQrToken(), qrRotatedAt: new Date() } });
    if (!count) return GONE;
  }
  await writeAudit({ userId, action: "menu.qr.rotate", entityType: kind === "table" ? "Table" : "QrPoint", entityId: id });
  return { ok: true };
}

const TAKEN = "A QR point with that name already exists.";
const sameName = (name: string, exceptId?: string) =>
  prisma.qrPoint.findFirst({ where: { name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });

export async function addQrPoint(input: { name: string; orderType: "TAKEAWAY" | "BAR_TAB" }, userId: string): Promise<ServiceResult & { id?: string }> {
  if (await sameName(input.name)) return { ok: false, error: TAKEN };
  for (let attempt = 0; ; attempt++) {
    try {
      const point = await prisma.qrPoint.create({ data: { name: input.name, orderType: input.orderType, qrToken: newQrToken() }, select: { id: true } });
      await writeAudit({ userId, action: "menu.point.create", entityType: "QrPoint", entityId: point.id, meta: { name: input.name, orderType: input.orderType } });
      return { ok: true, id: point.id };
    } catch (error) {
      // A token clash (2^144 to one): make another.
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
}

export async function renameQrPoint(id: string, name: string, userId: string): Promise<ServiceResult> {
  const point = await prisma.qrPoint.findFirst({ where: { id, deletedAt: null }, select: { name: true } });
  if (!point) return GONE;
  if (point.name === name) return { ok: true };
  if (await sameName(name, id)) return { ok: false, error: TAKEN };
  await prisma.qrPoint.update({ where: { id }, data: { name } });
  await writeAudit({ userId, action: "menu.point.rename", entityType: "QrPoint", entityId: id, meta: { from: point.name, to: name } });
  return { ok: true };
}

// Soft delete: its code stops working (a removed point's token opens nothing).
export async function removeQrPoint(id: string, userId: string): Promise<ServiceResult> {
  const { count } = await prisma.qrPoint.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!count) return GONE;
  await writeAudit({ userId, action: "menu.point.remove", entityType: "QrPoint", entityId: id });
  return { ok: true };
}
