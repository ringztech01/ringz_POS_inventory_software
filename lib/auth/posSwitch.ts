import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The touch POS's fast user switch (restaurant Part 6e): once the server
// action has checked a waiter's PIN (and that the till is signed in), it
// mints one of these and signs them in with it through the "pos-switch"
// credentials provider (auth.ts). The provider takes nothing else — no PIN,
// no password — so it can't be used to guess PINs from outside: a token is
// signed with a key derived from the app's login secret, names one user, is
// good for 60 seconds and works once.

const LABEL = "ringzpos-pos-switch-v1";
const LIFETIME_MS = 60_000;

// Tokens used already (until they'd have expired anyway), per server process.
const store = globalThis as typeof globalThis & { __posSwitchUsed?: Map<string, number> };
const used = (store.__posSwitchUsed ??= new Map<string, number>());

function key(): string | null {
  const base = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
  return base.length >= 16 ? createHmac("sha256", base).update(LABEL).digest("hex") : null;
}

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function createSwitchToken(userId: string, now = Date.now()): string | null {
  const secret = key();
  if (!secret) return null;
  const payload = `${Buffer.from(userId).toString("base64url")}.${now + LIFETIME_MS}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

// The user it names — or null: forged, expired, or used already.
export function redeemSwitchToken(token: unknown, now = Date.now()): string | null {
  const secret = key();
  if (!secret || typeof token !== "string" || token.length > 400) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [user, expires, nonce, mac] = parts;
  const expected = Buffer.from(sign(secret, `${user}.${expires}.${nonce}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const until = Number(expires);
  if (!Number.isFinite(until) || until < now) return null;
  for (const [t, at] of used) if (at < now) used.delete(t);
  if (used.has(token)) return null;
  used.set(token, until);
  return Buffer.from(user, "base64url").toString();
}
