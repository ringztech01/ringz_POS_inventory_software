// Run with: npx tsx --test modules/restaurant/__tests__/training.test.ts
// Part 6f Step 7f, from the source: a trainee can't change a real order (the
// one lock every order change takes); their orders are marked as they're
// opened; their tickets neither print nor show in the kitchen; settling one
// makes no sale; no counter sales; the dashboard leaves them out; the switch
// is the Administrator's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeAudit } from "../lib/auditEvents";

const src = (file: string) => readFileSync(file, "utf8");

test("a trainee can't change a real order: the lock every order change takes refuses it", () => {
  const orders = src("modules/restaurant/server/services/orders.ts");
  assert.match(orders, /SELECT status, tableId, version, training FROM \\`Order\\`/);
  assert.match(orders, /if \(!Number\(order\.training\) && \(await actorInTraining\(\)\)\) return \{ ok: false, error: TRAINING_REAL_ORDER \};/);
});

test("every new order carries its opener's flag", () => {
  assert.equal((src("modules/restaurant/server/services/floor.ts").match(/training: await trainingOf\(|const training = await trainingOf\(/g) ?? []).length, 4);
  assert.match(src("modules/restaurant/server/services/reservations.ts"), /training: await trainingOf\(tx, waiterId\)/);
});

test("the kitchen never gets them; settling makes no sale; no counter sales; the dashboard leaves them out", () => {
  assert.match(src("modules/restaurant/server/services/printing.ts"), /if \(training\.has\(kotId\)\) continue;/);
  assert.match(src("modules/restaurant/server/queries/kds.ts"), /order: \{ training: false \}/);
  const settle = src("modules/restaurant/server/services/settle.ts");
  assert.match(settle, /if \(order\.training\) \{[\s\S]*?return \{ ok: true, version, saleId: "", reference: "TRAINING"/);
  assert.match(src("modules/restaurant/server/actions/bill.ts"), /if \(result\.ok && result\.training\) \{\s*refresh\(\);\s*return \{ \.\.\.result, receiptPrinter: null \};/, "no drawer, no receipt");
  assert.match(src("app/(pos)/pos/actions.ts"), /if \(\(await getCurrentUserPermissions\(\)\)\.training\) return \{ ok: false, error: TRAINING_NO_COUNTER_SALES \};/);
  const dash = src("modules/restaurant/server/queries/dashboard.ts");
  assert.equal((dash.match(/training: false/g) ?? []).length, 3);
  assert.match(dash, /o\.\\`training\\` = 0/);
  assert.match(src("modules/restaurant/server/queries/prepTimes.ts"), /o\.training = 0/);
});

test("the switch is the Administrator's, logged", () => {
  assert.match(src("modules/restaurant/server/actions/training.ts"), /const admin = await requireAdministrator\(\);\s*if \(admin\.error !== undefined\) return/);
  assert.equal(describeAudit("staff.training.on", { name: "Ada Okafor" }, () => null)?.what, "Put Ada Okafor in training mode");
});
