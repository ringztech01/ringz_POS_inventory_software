// Run with: npx tsx --test modules/restaurant/__tests__/qrToken.test.ts
// Part 8 Step 1: a QR token (a table's or a QR point's) is 144 random bits,
// URL-safe, and says nothing about the table it opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newQrToken } from "../lib/qrToken";

test("18 random bytes as base64url: 24 URL-safe characters, at least 128 bits", () => {
  const token = newQrToken();
  assert.match(token, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(Buffer.from(token, "base64url").length * 8, 144);
});

test("never the same twice, and nothing like a table number", () => {
  const tokens = Array.from({ length: 5000 }, () => newQrToken());
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(tokens.every((t) => !/^\d+$/.test(t)), "never just digits");
  // Spread over the whole alphabet, as random bytes are (no fixed prefix).
  assert.ok(new Set(tokens.map((t) => t[0])).size > 50);
});
