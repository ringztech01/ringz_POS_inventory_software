import "server-only";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";

// The business's name (the Reports export's header, the menu's QR cards):
// the receipt header's first line, else the first warehouse, else the app's.
export async function businessName(): Promise<string> {
  const [setting, warehouse] = await Promise.all([
    prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { printHeader: true } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { name: true } }),
  ]);
  return setting?.printHeader?.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? warehouse?.name ?? "RingzPOS";
}

