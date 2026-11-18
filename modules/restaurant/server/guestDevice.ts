import "server-only";
import { randomBytes } from "node:crypto";
import { GUEST_DEVICE_COOKIE } from "../lib/guestOrdering";

// A guest's phone (Part 8 Step 7): a random id in a cookie the menu sets on
// its first order — the abuse log's fingerprint (with the address and the
// browser), and how the menu shows a phone its own order and nobody else's.

const ID = /^[A-Za-z0-9_-]{16,64}$/;

export function guestDeviceOf(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === GUEST_DEVICE_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return ID.test(value) ? value : null;
    }
  }
  return null;
}

export const newGuestDevice = () => randomBytes(18).toString("base64url");

// A year, on the menu's paths only, never readable by the page's script.
export const guestDeviceCookie = (id: string) => `${GUEST_DEVICE_COOKIE}=${id}; Path=/menu; Max-Age=31536000; HttpOnly; SameSite=Lax`;

// The phone's address as Next recorded it (the first of x-forwarded-for).
export const guestAddress = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
