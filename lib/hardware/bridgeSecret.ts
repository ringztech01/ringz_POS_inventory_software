import { createHmac } from "node:crypto";

// The secret the app server and the hardware bridge share — nothing to set
// up: derived from the app's own login secret (NEXTAUTH_SECRET / AUTH_SECRET,
// already in .env) with a one-way HMAC, so it's the same on every start and
// in every server process, unique to this install, and reveals nothing of
// the login secret. A BRIDGE_SECRET in .env (16+ characters) overrides it.

const LABEL = "ringzpos-hardware-bridge-v1";

export function bridgeSecret(): string | null {
  const own = process.env.BRIDGE_SECRET ?? "";
  if (own.length >= 16) return own;
  const base = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (base.length < 16) return null;
  return createHmac("sha256", base).update(LABEL).digest("hex");
}
