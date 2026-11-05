import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

// A table's QR code points at its digital menu: <app URL>/menu/<qrToken>.
// The app URL is NEXT_PUBLIC_APP_URL; without it, the address this request
// came in on.

export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function menuUrl(origin: string, qrToken: string): string {
  return `${origin}/menu/${qrToken}`;
}

// Medium error correction survives a scuffed or folded print.
const OPTIONS = { errorCorrectionLevel: "M", margin: 2 } as const;

export function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...OPTIONS, type: "png", width: 600 });
}

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: "svg" });
}
