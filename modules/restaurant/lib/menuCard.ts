// A table's (or QR point's) menu card, A6 (105 × 148 mm), as one SVG: the
// same picture is printed (four to an A4 sheet, or one alone) and saved as a
// PNG (Part 8 Step 2). Pure: the QR code's own SVG comes in made.
//
// Top to bottom: the business (its logo, or its name) on the accent colour,
// "Scan for menu", the table, its area, the code, the Wi-Fi if set, and the
// link in small type for anyone typing it.

export type MenuCard = {
  business: string;
  // A data: URI (PNG/JPEG/WebP); none: the business's name.
  logo?: string | null;
  title: string;
  subtitle: string;
  // The QR code as qrcode's SVG.
  qrSvg: string;
  link: string;
  wifi?: { name: string; password: string | null } | null;
  accent: string;
};

// Units: tenths of a millimetre.
export const CARD_W = 1050;
export const CARD_H = 1480;
const FONT = "Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif";
const INK = "#171b1c";
const SLATE = "#4d5659";
const QUIET = "#6d777a";

export const escapeXml = (text: string) =>
  text
    // Characters XML can't carry at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const HEX = /^#[0-9a-f]{6}$/i;

// Smaller type for longer text, so it stays inside the card.
export function fitSize(text: string, size: number, roomChars: number): number {
  return text.length <= roomChars ? size : Math.max(Math.round(size * 0.45), Math.floor((size * roomChars) / text.length));
}

const line = (y: number, text: string, size: number, weight: number, fill: string) =>
  `<text x="${CARD_W / 2}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="middle" fill="${fill}">${escapeXml(text)}</text>`;

// qrcode's <svg …> placed at (x, y), size × size.
function placeQr(qrSvg: string, x: number, y: number, size: number): string {
  const body = qrSvg.replace(/<\?xml[^>]*\?>/, "").trim();
  if (!body.startsWith("<svg")) throw new Error("Not a QR code SVG.");
  return body.replace(/^<svg\b/, `<svg x="${x}" y="${y}" width="${size}" height="${size}"`);
}

// as: "print" sizes the card in millimetres; "image" in pixels (1050 × 1480).
export function menuCardSvg(card: MenuCard, as: "print" | "image" = "print"): string {
  const accent = HEX.test(card.accent) ? card.accent : "#0f7d6a";
  const size = as === "print" ? `width="105mm" height="148mm"` : `width="${CARD_W}" height="${CARD_H}"`;
  const header = card.logo
    ? `<image href="${escapeXml(card.logo)}" x="225" y="30" width="600" height="170" preserveAspectRatio="xMidYMid meet"/>`
    : line(140, card.business, fitSize(card.business, 62, 22), 600, "#ffffff");
  const wifi = card.wifi?.name
    ? [
        `<rect x="150" y="1205" width="750" height="${card.wifi.password ? 160 : 100}" rx="22" fill="#f1f4f4"/>`,
        line(1272, `Wi-Fi: ${card.wifi.name}`, fitSize(`Wi-Fi: ${card.wifi.name}`, 44, 26), 600, INK),
        card.wifi.password ? line(1340, `Password: ${card.wifi.password}`, fitSize(`Password: ${card.wifi.password}`, 40, 28), 500, SLATE) : "",
      ].join("")
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${CARD_W} ${CARD_H}">`,
    `<rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>`,
    `<rect width="${CARD_W}" height="230" fill="${accent}"/>`,
    header,
    line(335, "Scan for menu", 54, 600, INK),
    line(455, card.title, fitSize(card.title, 100, 14), 700, INK),
    card.subtitle ? line(530, card.subtitle, fitSize(card.subtitle, 42, 30), 500, SLATE) : "",
    placeQr(card.qrSvg, 245, 570, 560),
    wifi,
    line(1440, card.link, fitSize(card.link, 26, 60), 400, QUIET),
    `</svg>`,
  ].join("");
}
