import { createHash, timingSafeEqual } from "node:crypto";

// Who may call the bridge: only the app server — a request from this
// machine (loopback) carrying the shared secret (BRIDGE_SECRET) in the
// X-Bridge-Secret header. The secrets are compared as SHA-256 digests in
// constant time (no length or timing leak).

export const SECRET_HEADER = "x-bridge-secret";
export const MIN_SECRET_LENGTH = 16;

export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function secretMatches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== "string" || !secret) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

// 401 / 403 / null (allowed).
export function refusal(remoteAddress: string | undefined, header: string | string[] | undefined, secret: string): { status: 401 | 403; error: string } | null {
  if (!isLoopback(remoteAddress)) return { status: 403, error: "The bridge only answers this machine." };
  if (!secretMatches(header, secret)) return { status: 401, error: "Wrong or missing bridge secret." };
  return null;
}
