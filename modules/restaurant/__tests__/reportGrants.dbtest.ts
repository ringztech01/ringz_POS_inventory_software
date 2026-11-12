// Restaurant Reports: the grant_manager_restaurant_reports data migration,
// against a real database (a throwaway copy — migrate deploy has already run
// it there). The built-in Manager role has Restaurant Reports (and View
// Cost); running the migration again does nothing; it only ever adds that one
// grant, to the built-in Manager role only — custom roles and anything an
// admin changed by hand are left as they are. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportGrants.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// The migration exactly as Prisma runs it (tests run from the project folder).
const migration = readFileSync(join(process.cwd(), "prisma/migrations/20261112150000_grant_manager_restaurant_reports/migration.sql"), "utf8").trim().replace(/;$/, "");
const runMigration = () => prisma.$executeRawUnsafe(migration);

let managerRoleId = "";
let customRoleId = "";
// Every grant in the database, as "roleId|permission".
const allGrants = async () => (await prisma.rolePermission.findMany({ select: { roleId: true, permission: true } })).map((g) => `${g.roleId}|${g.permission}`).sort();
const managerHas = async (permission: string) => (await prisma.rolePermission.count({ where: { roleId: managerRoleId, permission } })) === 1;

describe("Restaurant Reports grant (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    managerRoleId = (await prisma.role.findFirstOrThrow({ where: { systemRole: "MANAGER", deletedAt: null }, select: { id: true } })).id;
    // A custom role like a Manager's, without Restaurant Reports.
    customRoleId = (await prisma.role.create({ data: { name: `Shift lead ${Date.now()}`, accessLevel: "BACK_OFFICE", permissions: { create: [{ permission: P.MANAGE_ORDERS }, { permission: P.RESTAURANT_DASHBOARD }] } }, select: { id: true } })).id;
  });
  after(() => prisma.$disconnect());

  test("the built-in Manager role has Restaurant Reports and View Cost", async () => {
    assert.ok(await managerHas(P.RESTAURANT_REPORTS));
    assert.ok(await managerHas(P.VIEW_COST));
  });

  test("run again: nothing inserted, nothing changed", async () => {
    const before = await allGrants();
    assert.equal(await runMigration(), 0);
    assert.deepEqual(await allGrants(), before);
  });

  test("only the built-in Manager role gets it; a custom role is left alone", async () => {
    await prisma.rolePermission.delete({ where: { roleId_permission: { roleId: managerRoleId, permission: P.RESTAURANT_REPORTS } } });
    const before = await allGrants();
    assert.equal(await runMigration(), 1, "one grant: the Manager's");
    const added = (await allGrants()).filter((g) => !before.includes(g));
    assert.deepEqual(added, [`${managerRoleId}|${P.RESTAURANT_REPORTS}`]);
    assert.equal(await prisma.rolePermission.count({ where: { roleId: customRoleId, permission: P.RESTAURANT_REPORTS } }), 0);
  });

  test("a permission an admin took away by hand stays away; nothing is removed", async () => {
    const manual = P.MANAGE_FOOD;
    await prisma.rolePermission.deleteMany({ where: { roleId: managerRoleId, permission: manual } });
    const before = await allGrants();
    assert.equal(await runMigration(), 0);
    assert.deepEqual(await allGrants(), before);
    assert.ok(!(await managerHas(manual)), "still removed");
  });
});
