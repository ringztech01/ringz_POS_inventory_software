// Run with: npx tsx --test modules/restaurant/__tests__/audit.test.ts
// Part 6f Step 7e, without a database: each recorded event as a plain line
// in its kind, the view's filter (days, person, kind), and — from the source
// — who may open it and what's recorded for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeAudit, describeDrawer, describeVoid } from "../lib/auditEvents";
import { isServicePath, SERVICE_PERMISSIONS } from "../lib/serviceAccess";

const names: Record<string, string> = { u1: "Ada O.", u2: "Mona M." };
const name = (id: unknown) => (typeof id === "string" ? (names[id] ?? null) : null);

test("sign-ins and failed PINs, in plain words", () => {
  assert.deepEqual(describeAudit("auth.signin", { method: "password" }, name), { category: "SIGNIN", what: "Signed in with email and password", detail: null });
  assert.deepEqual(describeAudit("pin.signin", { tapped: false, method: "card" }, name)?.what, "Signed in with a staff card");
  assert.deepEqual(describeAudit("pos.switch", { method: "pin", from: "u2" }, name), { category: "SIGNIN", what: "Took over the till (PIN)", detail: "From Mona M." });
  assert.deepEqual(describeAudit("pin.signin.fail", { failures: 3 }, name), { category: "FAILED", what: "Wrong PIN", detail: "3 in a row" });
  assert.deepEqual(describeAudit("pin.signin.fail", { failures: 5, lockedSeconds: 60 }, name)?.detail, "Device locked 1 min");
  assert.equal(describeAudit("pin.signin.fail", { method: "card", failures: 1 }, name)?.what, "Unknown card");
  assert.equal(describeAudit("pin.signin.refused", { reason: "KITCHEN_SCREEN" }, name)?.category, "FAILED");
});

test("overrides name both people; PIN changes, staff, the till and devices", () => {
  assert.deepEqual(describeAudit("override.void", { approvedById: "u2", orderId: "o1" }, name), { category: "OVERRIDE", what: "A void, approved by Mona M.", detail: null });
  assert.deepEqual(describeAudit("override.drawer.approve", { forUserId: "u1", reason: "Change for a ₦1,000" }, name), { category: "OVERRIDE", what: "Approved opening the drawer for Ada O.", detail: "Change for a ₦1,000" });
  assert.deepEqual(describeAudit("staff.pin.reset", { name: "Ada Okafor", pin: "typed", sessionsEnded: true }, name), { category: "PIN", what: "Reset Ada Okafor's PIN", detail: "Signed out everywhere" });
  assert.equal(describeAudit("staff.card.set", { name: "Ada Okafor", card: "…4F2A" }, name)?.detail, "…4F2A");
  assert.equal(describeAudit("till.close", { expected: "10030.00", counted: "10000.00", variance: "-30.00" }, name)?.detail, "Expected ₦10030.00 · counted ₦10000.00 · short ₦30.00");
  assert.equal(describeAudit("device.pin.pair", { name: "Bar PC", kind: "BAR" }, name)?.detail, "Bar terminal");
  assert.equal(describeAudit("something.unknown", {}, name), null, "not shown");
  assert.deepEqual(describeVoid({ quantity: 2, item: "Jollof", orderRef: "ORD-0012", reason: "Cold" }), { category: "VOID", what: "Voided 2× Jollof on ORD-0012", detail: "Cold" });
  assert.deepEqual(describeDrawer({ reason: "MANUAL", note: "Change", refLabel: null }), { category: "DRAWER", what: "Opened the drawer by hand", detail: "Change" });
});

const src = (file: string) => readFileSync(file, "utf8");

test("who sees it: View Audit Log (Managers by the migration, the Administrator always) — never a service role", () => {
  assert.match(src("modules/restaurant/pages/AuditPage.tsx"), /guardPage\(RESTAURANT_PERMISSIONS\.VIEW_AUDIT_LOG\)/);
  assert.ok(!SERVICE_PERMISSIONS.includes("View Audit Log" as never));
  assert.ok(!isServicePath("/settings/restaurant/audit"));
  assert.match(src("prisma/migrations/20261112090000_add_view_audit_log/migration.sql"), /WHERE `systemRole` = 'MANAGER' AND `deletedAt` IS NULL/);
});

test("what's recorded for it: email sign-ins and the POS switch", () => {
  assert.match(src("auth.ts"), /await noteSignIn\(user\.id, "password"\);/);
  assert.match(src("lib/auth/signIns.ts"), /if \(method\) await writeAudit\(\{ userId, action: "auth\.signin"/);
  assert.match(src("modules/restaurant/server/actions/pos.ts"), /action: "pos\.switch"/);
});
