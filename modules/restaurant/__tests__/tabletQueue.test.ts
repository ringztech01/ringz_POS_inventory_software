// Run with: npx tsx --test modules/restaurant/__tests__/tabletQueue.test.ts
// Part 6g Step 6: the tablet's add queue (lib/tabletQueue.ts) — a lost answer
// never adds a dish twice, what's stored survives a reload, what a refusal says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { didLand, isVersionConflict, matchQuantity, queueKey, readStoredQueue, rejectionText, VERSION_CONFLICT, waitingText, type QueueEntry } from "../lib/tabletQueue";
import { newUuid } from "@/lib/newUuid";

const line = (l: Partial<{ productId: string; modifierIds: string[]; note: string | null; quantity: number; cancelled: boolean }> = {}) => ({ productId: "jollof", modifierIds: ["large", "hot"], note: null, quantity: 1, cancelled: false, ...l });
const entry = { productId: "jollof", modifierIds: ["hot", "large"] };

test("how many of a dish: the same options in any order, no note, not cancelled", () => {
  assert.equal(matchQuantity([line({ quantity: 2 }), line({ quantity: 1 })], entry), 3);
  assert.equal(matchQuantity([line({ modifierIds: ["large"] })], entry), 0, "other options");
  assert.equal(matchQuantity([line({ productId: "suya" })], entry), 0, "another dish");
  assert.equal(matchQuantity([line({ note: "No onion" })], entry), 0, "a line with a note is another line");
  assert.equal(matchQuantity([line({ cancelled: true })], entry), 0, "voided");
  assert.equal(matchQuantity([], entry), 0);
});

test("a lost answer: more of the dish than before means it landed; no more means send it again", () => {
  assert.equal(didLand({ ...entry, baseline: 1 }, [line({ quantity: 2 })]), true);
  assert.equal(didLand({ ...entry, baseline: 2 }, [line({ quantity: 2 })]), false);
  assert.equal(didLand({ ...entry, baseline: 0 }, []), false);
  assert.equal(didLand({ ...entry, baseline: null }, [line({ quantity: 9 })]), false, "never tried");
});

test("a refusal, in one line; only a version conflict is worth retrying", () => {
  assert.equal(rejectionText("Star Lager", "Star Lager is out of stock in this order's warehouse."), "Not added: Star Lager is out of stock in this order's warehouse.");
  assert.equal(rejectionText("Star Lager", "This order is closed."), "Star Lager not added: This order is closed.");
  assert.equal(rejectionText("Star Lager", VERSION_CONFLICT), "Star Lager not added: the order was changed elsewhere. Add it again.");
  assert.equal(isVersionConflict(VERSION_CONFLICT), true);
  assert.equal(isVersionConflict("This order is closed."), false);
});

test("the conflict's words are the server's own", () => {
  assert.ok(readFileSync("modules/restaurant/server/services/orders.ts", "utf8").includes(`export const STALE = "${VERSION_CONFLICT}"`));
});

test("what's stored comes back checked; anything malformed is left out", () => {
  const good: QueueEntry = { key: "a", productId: "p", name: "Star", price: "₦1,200", options: [], modifierIds: [], baseline: 2, doneAt: 9 };
  assert.deepEqual(readStoredQueue({ title: "O61", entries: [good, { key: "b" }, null, "x"] }), { title: "O61", entries: [{ ...good, doneAt: null }] });
  assert.deepEqual(readStoredQueue(null), { title: "", entries: [] });
  assert.deepEqual(readStoredQueue({ entries: "nope" }), { title: "", entries: [] });
  assert.equal(queueKey("o1"), "ringz.tablet.queue.o1");
  assert.equal(waitingText(1, "O61"), "1 dish on O61 waiting to sync");
  assert.equal(waitingText(3, "O61"), "3 dishes on O61 waiting to sync");
});

test("a payment's key: a valid v4 UUID, without crypto.randomUUID (missing on http:// pages)", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (a: Uint8Array) => globalThis.structuredClone(a).map((_, i) => (i * 37 + 11) % 256) } });
  try {
    assert.match(newUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
  }
  assert.notEqual(newUuid(), newUuid());
});
