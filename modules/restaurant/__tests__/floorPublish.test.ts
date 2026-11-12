// Run with: npx tsx --test modules/restaurant/__tests__/floorPublish.test.ts
// Publishing a floor plan (Part 7 Step 4), without a database: who changed
// it, the "N tablets updated" count, and the words the editor shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../lib/floorPresence";
import { bookingReason, changedBy, openOrderReason, reachText, shortName } from "../lib/floorRules";

test("who changed it: first name and the last name's initial", () => {
  assert.equal(shortName("Grace", "Mensah"), "Grace M.");
  assert.equal(shortName(" Ade ", "  okafor"), "Ade O.");
  assert.equal(shortName("Admin", ""), "Admin");
  assert.equal(changedBy("Grace M.", 13), "Layout changed by Grace M. Reload?");
  assert.equal(changedBy("Admin", 13), "Layout changed by Admin. Reload?");
  assert.equal(changedBy(null, 13), "Layout changed elsewhere (now v13). Reload?");
});

test("why a table can't be taken off", () => {
  assert.equal(openOrderReason("T4"), "Table T4 has an open order, so it can't be removed. Close or move the order first.");
  assert.equal(bookingReason("T4", "Okafor", "19:30"), "Table T4 has a booking today (Okafor at 19:30), so it can't be removed. Move or cancel the booking first.");
});

test("tablets: counted while heard from in the last 20 s; updated once they've drawn the saved version", () => {
  const presence = createPresence(20_000);
  const t0 = 1_000_000;
  presence.note("tablet-1", { hall: 12, bar: 3 }, t0);
  presence.note("tablet-2", { hall: 12, bar: 3 }, t0);
  presence.note("old-tablet", { hall: 11 }, t0 - 25_000);
  assert.deepEqual(presence.reach({ hall: 13 }, t0), { showing: 2, updated: 0 }, "the old one has gone quiet");
  presence.note("tablet-1", { hall: 13, bar: 3 }, t0 + 4_000);
  assert.deepEqual(presence.reach({ hall: 13 }, t0 + 4_000), { showing: 2, updated: 1 });
  presence.note("tablet-2", { hall: 13, bar: 3 }, t0 + 5_000);
  assert.deepEqual(presence.reach({ hall: 13 }, t0 + 5_000), { showing: 2, updated: 2 });
  // Two areas saved together: both must be drawn.
  assert.deepEqual(presence.reach({ hall: 13, bar: 4 }, t0 + 5_000), { showing: 2, updated: 0 });
  // A newer version than asked for counts too.
  assert.deepEqual(presence.reach({ hall: 12 }, t0 + 5_000), { showing: 2, updated: 2 });
  // Closed (no more refreshes): gone after 20 s.
  assert.deepEqual(presence.reach({ hall: 13 }, t0 + 26_000), { showing: 0, updated: 0 });
});

test("the toast after SAVE", () => {
  assert.equal(reachText("Saved v13", null), "Saved v13 · updating tablets…");
  assert.equal(reachText("Saved v13", { showing: 3, updated: 3 }), "Saved v13 · 3 tablets updated");
  assert.equal(reachText("Saved v13", { showing: 1, updated: 1 }), "Saved v13 · 1 tablet updated");
  assert.equal(reachText("Saved v13", { showing: 3, updated: 2 }), "Saved v13 · 2 tablets updated, 1 still to refresh");
  assert.equal(reachText("Saved v13", { showing: 0, updated: 0 }), "Saved v13 · no tablets are showing the floor right now");
});
