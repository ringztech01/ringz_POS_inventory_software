// Part 6f Step 2 against a real database (a throwaway copy): the six
// built-in roles after the migration; the matrix's save (permissions,
// access level, home screen — the Administrator keeps everything) with each
// change in the audit log; refusals that write nothing; Copy role. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/staffRoles.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { copyRole, getRoleMatrix, saveRoleMatrix } from "../server/services/staffRoles";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-5);
let userId = "";

const row = async (name: string) => {
  const role = (await getRoleMatrix()).roles.find((r) => r.name === name)!;
  return { id: role.id, permissions: role.permissions, accessLevel: role.accessLevel, homeScreen: role.homeScreen, homeAreaId: role.homeAreaId, homeStation: role.homeStation };
};

describe("Staff roles (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  });
  after(() => prisma.$disconnect());

  test("the six built-in roles, in order, with their access levels and homes; nothing else built in", async () => {
    const matrix = await getRoleMatrix();
    const builtIn = matrix.roles.filter((r) => r.systemRole);
    assert.deepEqual(builtIn.map((r) => [r.systemRole, r.accessLevel, r.homeScreen]), [
      ["ADMINISTRATOR", "BACK_OFFICE", "TABLES"],
      ["MANAGER", "BACK_OFFICE", "TABLES"],
      ["CASHIER", "SERVICE", "CASHIER"],
      ["WAITER", "SERVICE", "TABLES"],
      ["BARTENDER", "SERVICE", "BAR"],
      ["KITCHEN", "SERVICE", "KITCHEN"],
    ]);
    assert.equal(builtIn.find((r) => r.systemRole === "BARTENDER")!.name, "Bartender");
    assert.deepEqual(builtIn[0].permissions, [...ALL_PERMISSIONS], "the Administrator: every permission");
    assert.ok(matrix.groups.length >= 2, "core and restaurant groups");
  });

  test("save: Waiter gets Settle Bill and the back office; Kitchen opens on its station — logged with what changed", async () => {
    const waiter = await row("Waiter");
    const kitchen = await row("Kitchen");
    const station = (await prisma.kitchenStation.findFirstOrThrow({ select: { code: true } })).code;
    const result = await saveRoleMatrix({ roles: [{ ...waiter, permissions: [...waiter.permissions, "Settle Bill"], accessLevel: "BACK_OFFICE" }, { ...kitchen, homeStation: station }] }, userId);
    assert.deepEqual(result, { ok: true, changed: 2 });
    const after = await row("Waiter");
    assert.ok(after.permissions.includes("Settle Bill"));
    assert.equal(after.accessLevel, "BACK_OFFICE");
    assert.equal((await row("Kitchen")).homeStation, station);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "role.update", entityId: waiter.id }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(log.meta, { role: "Waiter", added: ["Settle Bill"], accessLevel: { from: "SERVICE", to: "BACK_OFFICE" } });
    // Nothing different: nothing written.
    assert.deepEqual(await saveRoleMatrix({ roles: [await row("Waiter")] }, userId), { ok: true, changed: 0 });
    // Back as it was.
    assert.deepEqual(await saveRoleMatrix({ roles: [waiter, kitchen] }, userId), { ok: true, changed: 2 });
  });

  test("the Administrator keeps every permission and the back office, whatever is sent; its home can change", async () => {
    const admin = await row("Administrator");
    const result = await saveRoleMatrix({ roles: [{ ...admin, permissions: ["Manage Orders"], accessLevel: "SERVICE", homeScreen: "CASHIER" }] }, userId);
    assert.ok(result.ok);
    const after = await row("Administrator");
    assert.deepEqual([after.permissions.length, after.accessLevel, after.homeScreen], [ALL_PERMISSIONS.length, "BACK_OFFICE", "CASHIER"]);
    await saveRoleMatrix({ roles: [admin] }, userId);
  });

  test("refused, nothing written: a made-up permission, a deleted area", async () => {
    const waiter = await row("Waiter");
    const before = await prisma.auditLog.count();
    assert.deepEqual(await saveRoleMatrix({ roles: [{ ...waiter, permissions: ["Launch Rockets"] }] }, userId), { ok: false, error: "“Launch Rockets” isn't a permission." });
    assert.deepEqual(await saveRoleMatrix({ roles: [{ ...waiter, homeAreaId: "no-such-area" }] }, userId), { ok: false, error: "One of those areas has been deleted. Reload the page." });
    assert.deepEqual(await row("Waiter"), waiter);
    assert.equal(await prisma.auditLog.count(), before);
  });

  test("Copy role: a custom role like the Bartender (permissions, access, home), deletable; names unique", async () => {
    const bartender = await row("Bartender");
    const name = `Barback ${stamp}`;
    const copied = await copyRole({ fromId: bartender.id, name }, userId);
    assert.ok(copied.ok, JSON.stringify(copied));
    const made = (await getRoleMatrix()).roles.find((r) => r.name === name)!;
    assert.deepEqual([made.systemRole, made.permissions, made.accessLevel, made.homeScreen, made.homeAreaId], [null, bartender.permissions, "SERVICE", "BAR", bartender.homeAreaId]);
    assert.deepEqual(await copyRole({ fromId: bartender.id, name: name.toUpperCase() }, userId), { ok: false, error: `A role called “${name.toUpperCase()}” already exists.` });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "role.copy", entityId: made.id } });
    assert.deepEqual(log.meta, { from: "Bartender", to: name, permissions: bartender.permissions.length });
    // The Administrator's copy is a custom role with every permission written out.
    const fromAdmin = await copyRole({ fromId: (await row("Administrator")).id, name: `Deputy ${stamp}` }, userId);
    assert.ok(fromAdmin.ok);
    const deputy = await prisma.role.findUniqueOrThrow({ where: { id: fromAdmin.ok ? fromAdmin.id : "" }, select: { isSystem: true, systemRole: true, accessLevel: true, _count: { select: { permissions: true } } } });
    assert.deepEqual(deputy, { isSystem: false, systemRole: null, accessLevel: "BACK_OFFICE", _count: { permissions: ALL_PERMISSIONS.length } });
  });
});
