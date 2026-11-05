import { randomBytes } from "node:crypto";

// A table's digital-menu token (/menu/[qrToken]): 18 random bytes as
// base64url — 24 URL-safe characters. Server-side only; Table.qrToken's
// unique index backs it up.
export function newQrToken(): string {
  return randomBytes(18).toString("base64url");
}
