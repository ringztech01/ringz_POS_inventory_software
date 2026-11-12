// Who can open Restaurant Reports and Prep times, against a real database (a
// throwaway copy, its built-in roles as they are after the migrations): both
// pages are guarded by Restaurant Reports. A Manager has it (the
// grant_manager_restaurant_reports migration); a Waiter doesn't — and, being
// Service-only, is sent home first and never given it even if their role is
// ticked for it by hand (Part 6f). The pages themselves are checked in the
// browser. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportAccess.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { permissionsForUser } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const user: Record<"manager" | "waiter" | "tickedWaiter", string> = { manager: "", waiter: "", tickedWaiter: "" };

describe("Reports access (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const stamp = Date.now();
    const roleOf = async (systemRole: "MANAGER" | "WAITER") => (await prisma.role.findFirstOrThrow({ where: { systemRole, deletedAt: null }, select: { id: true } })).id;
    const make = async (first: string, roleId: string) =>
      (await prisma.user.create({ data: { firstName: first, lastName: "Check", email: `${first.toLowerCase()}-${stamp}@check.test`, password: await bcrypt.hash("x", 4), roleId }, select: { id: true } })).id;
    user.manager = await make("Mona", await roleOf("MANAGER"));
    user.waiter = await make("Wale", await roleOf("WAITER"));
    // A Service role someone ticked Restaurant Reports on by hand.
    const ticked = await prisma.role.create({ data: { name: `Ticked waiter ${stamp}`, accessLevel: "SERVICE", permissions: { create: [{ permission: P.MANAGE_ORDERS }, { permission: P.RESTAURANT_REPORTS }] } }, select: { id: true } });
    user.tickedWaiter = await make("Tayo", ticked.id);
  });
  after(() => prisma.$disconnect());

  test("Reports and Prep times are both guarded by Restaurant Reports", () => {
    for (const page of ["modules/restaurant/pages/ReportsPage.tsx", "modules/restaurant/pages/PrepTimesPage.tsx"]) {
      assert.match(readFileSync(join(process.cwd(), page), "utf8"), /await guardPage\(RESTAURANT_PERMISSIONS\.RESTAURANT_REPORTS\)/, page);
    }
  });

  test("a Manager can open them", async () => {
    const manager = await permissionsForUser(user.manager);
    assert.ok(manager.permissions.has(P.RESTAURANT_REPORTS));
    assert.equal(manager.serviceOnly, false, "back office: not sent home");
  });

  test("a Waiter can't: no Restaurant Reports (the no-permission page), and sent home first", async () => {
    const waiter = await permissionsForUser(user.waiter);
    assert.ok(!waiter.permissions.has(P.RESTAURANT_REPORTS));
    if (await isModuleEnabled("restaurant")) assert.equal(waiter.serviceOnly, true);
  });

  test("a Service role ticked for Restaurant Reports by hand still doesn't get it", async () => {
    const ticked = await permissionsForUser(user.tickedWaiter);
    if (await isModuleEnabled("restaurant")) {
      assert.ok(!ticked.permissions.has(P.RESTAURANT_REPORTS));
      assert.ok(ticked.withheld.has(P.RESTAURANT_REPORTS), "withheld: Service only");
    }
  });
});
