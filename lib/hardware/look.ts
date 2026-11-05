import type { Raster } from "./raster";
import type { TicketLook } from "./tickets";

// The ticket settings as the screen edits them, and as tickets.ts takes them
// (TicketLook). Pure — the Settings preview uses it in the browser.

export type TicketSettings = {
  logo: boolean;
  logoImage: Raster | null;
  header: string;
  footer: string;
  kitchenLarge: boolean;
  kotPrices: boolean;
  qr: boolean;
  qrText: string;
};

export const linesOf = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function lookFrom(s: TicketSettings): TicketLook {
  return {
    header: linesOf(s.header),
    footer: linesOf(s.footer),
    logo: s.logo ? s.logoImage : null,
    qr: s.qr && s.qrText.trim() ? s.qrText.trim() : null,
    kitchenLarge: s.kitchenLarge,
    kotPrices: s.kotPrices,
  };
}
