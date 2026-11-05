// Run with: npx tsx --test modules/restaurant/__tests__/orderFlow.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelReasonText } from "../lib/cancelReasons";
import { cancelOrderBlocker } from "../lib/orderLines";
import { cancelLineSchema, cancelOrderSchema } from "../schemas/orderFlow";

test("the saved cancel reason", () => {
  assert.equal(cancelReasonText("WRONG_ITEM", null), "Wrong item");
  assert.equal(cancelReasonText("WRONG_ITEM", "brought Fanta"), "Wrong item: brought Fanta");
  assert.equal(cancelReasonText("CHANGED_MIND", null), "Customer changed mind");
  assert.equal(cancelReasonText("OTHER", "spilled at the table"), "spilled at the table");
});

test("an order can be cancelled only with nothing live in the kitchen", () => {
  assert.equal(cancelOrderBlocker(0), null);
  assert.equal(cancelOrderBlocker(2), "Cancel its sent lines first — the kitchen may already be making them.");
});

test("a reason is required; Other needs details; details at most 140", () => {
  const line = { orderId: "o1", version: 2, lineId: "l1" };
  assert.equal(cancelLineSchema.safeParse({ ...line, reason: "KITCHEN_ISSUE", details: "" }).success, true);
  assert.equal(cancelLineSchema.parse({ ...line, reason: "KITCHEN_ISSUE", details: "  burnt " }).details, "burnt");
  assert.equal(cancelLineSchema.safeParse({ ...line, details: "" }).success, false);
  assert.equal(cancelLineSchema.safeParse({ ...line, reason: "BORED", details: "" }).success, false);
  const other = cancelOrderSchema.safeParse({ orderId: "o1", version: 2, reason: "OTHER", details: " " });
  assert.equal(other.success, false);
  assert.deepEqual(other.success ? null : other.error.issues.map((i) => [i.path.join("."), i.message]), [["details", "Say what happened."]]);
  assert.equal(cancelOrderSchema.safeParse({ orderId: "o1", version: 2, reason: "OTHER", details: "x".repeat(141) }).success, false);
});
