import { prisma } from "@/lib/db";
import { lookFrom, type TicketSettings } from "./look";
import type { TicketLook } from "./tickets";

export { lookFrom, type TicketSettings };

// The business look for printed tickets (Settings › Ticket templates), as
// lib/hardware/tickets.ts takes it: kept for 15 s (the worker renders every
// job with it), dropped as soon as the settings are saved. No server-only
// marker: the print worker uses it.

const TTL_MS = 15_000;
const g = globalThis as typeof globalThis & { __ringzTicketLook?: { at: number; look: Promise<TicketLook> } };

export async function getTicketSettings(): Promise<TicketSettings> {
  const s = await prisma.businessSetting.findUnique({
    where: { id: "default" },
    select: { printLogo: true, printLogoWidth: true, printLogoHeight: true, printLogoData: true, printHeader: true, printFooter: true, printKitchenLarge: true, printKotPrices: true, printQr: true, printQrText: true },
  });
  return {
    logo: s?.printLogo ?? false,
    logoImage: s?.printLogoData && s.printLogoWidth && s.printLogoHeight ? { width: s.printLogoWidth, height: s.printLogoHeight, data: new Uint8Array(s.printLogoData) } : null,
    header: s?.printHeader ?? "",
    footer: s?.printFooter ?? "",
    kitchenLarge: s?.printKitchenLarge ?? false,
    kotPrices: s?.printKotPrices ?? false,
    qr: s?.printQr ?? false,
    qrText: s?.printQrText ?? "",
  };
}

export function loadTicketLook(): Promise<TicketLook> {
  const cached = g.__ringzTicketLook;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.look;
  const look = getTicketSettings().then(lookFrom);
  g.__ringzTicketLook = { at: Date.now(), look };
  look.catch(() => {
    delete g.__ringzTicketLook;
  });
  return look;
}

export function forgetTicketLook(): void {
  delete g.__ringzTicketLook;
}
