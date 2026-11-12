// Part 6f Step 7e against a real database (a throwaway copy): the audit view
// merges the audit log, voided lines and the drawer's openings, newest
// first; filters by days, person and kind; counts each kind. The migration
// gave the Manager role View Audit Log. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/audit.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { addDays, todayInAppZone } from "@/lib/dateRanges";
import { auditFilter, getAuditView } from "../server/services/audit";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
let admin = "";
let other = "";
const today = todayInAppZone();

describe("Audit view (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    admin = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    other = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, id: { not: admin } }, select: { id: true } })).id;
    // Today: a sign-in and a failed PIN; an override for `other`, approved by the admin; yesterday: a PIN reset.
    const yesterday = new Date(`${addDays(today, -1)}T12:00:00.000+01:00`);
    await prisma.auditLog.createMany({
      data: [
        { userId: admin, action: "auth.signin", entityType: "Device", entityId: null, meta: { method: "password" } },
        { userId: null, action: "pin.signin.fail", entityType: "Device", entityId: null, meta: { failures: 2, tag: stamp } },
        { userId: other, action: "override.void", entityType: "OrderItem", entityId: `x${stamp}`, meta: { approvedById: admin } },
        { userId: admin, action: "override.void.approve", entityType: "OrderItem", entityId: `x${stamp}`, meta: { forUserId: other } },
        { userId: admin, action: "staff.pin.reset", entityType: "User", entityId: other, meta: { name: "Someone", sessionsEnded: true }, createdAt: yesterday },
      ],
    });
  });
  after(() => prisma.$disconnect());

  test("the filter: the last seven days by default; days the wrong way round are swapped; unknown kinds ignored", () => {
    const f = auditFilter({}, new Date(`${today}T12:00:00.000+01:00`));
    assert.deepEqual([f.from, f.to, f.userId, f.category], [addDays(today, -6), today, null, null]);
    const swapped = auditFilter({ from: today, to: addDays(today, -2), type: "NOPE" });
    assert.deepEqual([swapped.from, swapped.to, swapped.category], [addDays(today, -2), today, null]);
  });

  test("everything, newest first, each kind counted; the override shows for both people", async () => {
    const view = await getAuditView(auditFilter({ from: addDays(today, -1), to: today }));
    const whats = view.rows.map((r) => r.what);
    assert.ok(whats.includes("Signed in with email and password"));
    assert.ok(whats.includes("Wrong PIN"));
    assert.ok(view.rows.some((r) => r.category === "OVERRIDE" && r.whoId === other && /approved by/.test(r.what)));
    assert.ok(view.rows.some((r) => r.category === "OVERRIDE" && r.whoId === admin && /^Approved a void for /.test(r.what)));
    assert.ok(whats.includes("Reset Someone's PIN"));
    const times = view.rows.map((r) => r.at);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");
    assert.ok(view.counts.SIGNIN >= 1 && view.counts.FAILED >= 1 && view.counts.OVERRIDE >= 2 && view.counts.PIN >= 1);
  });

  test("one person, one kind, one day", async () => {
    const mine = await getAuditView(auditFilter({ from: addDays(today, -1), to: today, user: other }));
    assert.ok(mine.rows.length > 0 && mine.rows.every((r) => r.whoId === other));
    const failed = await getAuditView(auditFilter({ from: today, to: today, type: "FAILED" }));
    assert.ok(failed.rows.length > 0 && failed.rows.every((r) => r.category === "FAILED"));
    const todayOnly = await getAuditView(auditFilter({ from: today, to: today, type: "PIN" }));
    assert.ok(!todayOnly.rows.some((r) => r.what === "Reset Someone's PIN"), "yesterday's reset isn't today's");
  });

  test("the migration gave the Manager role View Audit Log", async () => {
    const manager = await prisma.role.findFirst({ where: { systemRole: "MANAGER", deletedAt: null }, select: { permissions: { select: { permission: true } } } });
    if (manager) assert.ok(manager.permissions.some((p) => p.permission === "View Audit Log"));
  });
});
