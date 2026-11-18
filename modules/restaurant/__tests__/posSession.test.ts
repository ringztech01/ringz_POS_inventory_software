// Run with: npx tsx --test modules/restaurant/__tests__/posSession.test.ts
// The touch POS's session pieces (Part 6e Step 5): the one-time sign-in
// token behind the PIN switch, bar tab labels, and what the browser may send.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createSwitchToken, redeemSwitchToken } from "@/lib/auth/posSwitch";
import { noTableLabel } from "../lib/orderLines";
import { newPosOrderSchema, posSettingsSchema, posSwitchSchema } from "../schemas/pos";

// The token's key is read when it's used.
process.env.AUTH_SECRET = "test-secret-for-the-pos-switch-0123456789";

test("the switch token: names its user, works once, for 60 seconds, and can't be forged", () => {
  const now = Date.now();
  const token = createSwitchToken("user-1", now)!;
  assert.ok(token);
  assert.equal(redeemSwitchToken(token, now + 1_000), "user-1");
  assert.equal(redeemSwitchToken(token, now + 2_000), null, "used already");
  const late = createSwitchToken("user-2", now)!;
  assert.equal(redeemSwitchToken(late, now + 61_000), null, "expired");
  const other = createSwitchToken("user-3", now)!;
  const [user, expires, nonce, mac] = other.split(".");
  const forged = [Buffer.from("admin").toString("base64url"), expires, nonce, mac].join(".");
  assert.equal(redeemSwitchToken(forged, now), null, "another user's name with this signature");
  assert.equal(redeemSwitchToken([user, String(now + 999_999), nonce, mac].join("."), now), null, "a longer life");
  assert.equal(redeemSwitchToken("nonsense", now), null);
  assert.equal(redeemSwitchToken(undefined, now), null);
});

test("no secret, no token", () => {
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  const nextauth = process.env.NEXTAUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  try {
    assert.equal(createSwitchToken("user-1"), null);
  } finally {
    process.env.AUTH_SECRET = saved;
    if (nextauth !== undefined) process.env.NEXTAUTH_SECRET = nextauth;
  }
});

test("an order with no table: a bar tab by its name, others by their type", () => {
  assert.equal(noTableLabel("BAR_TAB", "Ada"), "Tab · Ada");
  assert.equal(noTableLabel("BAR_TAB", null), "Bar tab");
  assert.equal(noTableLabel("TAKEAWAY", null), "Takeaway");
  // A takeaway a guest ordered from a QR point carries their name (Part 8 Step 8).
  assert.equal(noTableLabel("TAKEAWAY", "Ada"), "Takeaway · Ada");
  assert.equal(noTableLabel("DELIVERY", "ignored"), "Delivery");
});

test("what the browser may send: a takeaway, a named tab, a PIN, the settings", () => {
  assert.deepEqual(newPosOrderSchema.parse({ type: "TAKEAWAY", tableId: "x" }), { type: "TAKEAWAY" });
  assert.deepEqual(newPosOrderSchema.parse({ type: "BAR_TAB", tabName: "  Ada — blue shirt " }), { type: "BAR_TAB", tabName: "Ada — blue shirt" });
  assert.equal(newPosOrderSchema.safeParse({ type: "BAR_TAB", tabName: "  " }).error?.issues[0]?.message, "Give the tab a name.");
  assert.equal(newPosOrderSchema.safeParse({ type: "BAR_TAB", tabName: "x".repeat(41) }).success, false);
  assert.equal(newPosOrderSchema.safeParse({ type: "DINE_IN" }).success, false, "dine-in starts from a table");
  assert.equal(posSwitchSchema.safeParse({ userId: "u1", pin: "123" }).success, false);
  assert.equal(posSwitchSchema.safeParse({ userId: "u1", pin: "1234" }).success, true);
  assert.equal(posSettingsSchema.safeParse({ returnHome: false, sendToFloor: true, lockSeconds: 60, lockSecondsManager: 300, lightTheme: false }).success, true);
  assert.equal(posSettingsSchema.safeParse({ returnHome: false, sendToFloor: true, lockSeconds: 60, lockSecondsManager: 0, lightTheme: false }).success, false, "managers: never isn't one of theirs");
  assert.equal(posSettingsSchema.safeParse({ returnHome: false, sendToFloor: true, lockSeconds: 45, lockSecondsManager: 300, lightTheme: false }).success, false);
  assert.equal(posSettingsSchema.safeParse({ returnHome: false, sendToFloor: true, lockSeconds: 60, lockSecondsManager: 300 }).success, false, "the theme is part of it");
});
