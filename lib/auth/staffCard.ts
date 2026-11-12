import "server-only";
import { createHmac } from "node:crypto";

// Staff cards and badges (Part 6f Step 7d): an RFID/NFC card or a barcode
// badge, read by the scanner (it types the code and Enter), signs someone
// in like their PIN. The code is never stored: only a keyed hash (HMAC with
// a key from the app's login secret, so a copied database can't be checked
// against card numbers), one person per card, and its last characters to
// tell cards apart.

const LABEL = "ringzpos-staff-card-v1";

// What a reader sends, tidied: no spaces, upper case; 4 to 64 printable
// characters — or null.
export function normaliseCard(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const code = typed.replace(/\s+/g, "").toUpperCase();
  return /^[\x21-\x7E]{4,64}$/.test(code) ? code : null;
}

export function cardHash(code: string): string | null {
  const base = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (base.length < 16) return null;
  const key = createHmac("sha256", base).update(LABEL).digest();
  return createHmac("sha256", key).update(code).digest("hex");
}

// "…4F2A".
export const cardLabel = (code: string) => `…${code.slice(-4)}`;
