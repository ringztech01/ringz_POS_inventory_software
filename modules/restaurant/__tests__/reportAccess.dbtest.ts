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
import { guardPage } from "../server/guard";
import { exportReport } from "../server/reportExportRoute";
import { reprintZReport } from "../server/actions/reports";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const user: Record<"manager" | "waiter" | "tickedWaiter", string> = { manager: "", waiter: "", tickedWaiter: "" };
// Step 12: every Service role, as built (none of them opens Reports).
const SERVICE_ROLES = ["WAITER", "CASHIER", "BARTENDER", "KITCHEN"] as const;
const service: Partial<Record<(typeof SERVICE_ROLES)[number], string>> = {};

describe("Reports access (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const stamp = Date.now();
    const roleOf = async (systemRole: "MANAGER" | (typeof SERVICE_ROLES)[number]) => (await prisma.role.findFirstOrThrow({ where: { systemRole, deletedAt: null }, select: { id: true } })).id;
    const make = async (first: string, roleId: string) =>
      (await prisma.user.create({ data: { firstName: first, lastName: "Check", email: `${first.toLowerCase()}-${stamp}@check.test`, password: await bcrypt.hash("x", 4), roleId }, select: { id: true } })).id;
    user.manager = await make("Mona", await roleOf("MANAGER"));
    user.waiter = await make("Wale", await roleOf("WAITER"));
    // A Service role someone ticked Restaurant Reports on by hand.
    const ticked = await prisma.role.create({ data: { name: `Ticked waiter ${stamp}`, accessLevel: "SERVICE", permissions: { create: [{ permission: P.MANAGE_ORDERS }, { permission: P.RESTAURANT_REPORTS }] } }, select: { id: true } });
    user.tickedWaiter = await make("Tayo", ticked.id);
    for (const role of SERVICE_ROLES) service[role] = await make(`Svc${role[0]}${role.slice(1).toLowerCase()}`, await roleOf(role));
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

  test("Waiter, Cashier, Bartender and Kitchen: none has Restaurant Reports or View Cost; each is sent home first", async () => {
    const on = await isModuleEnabled("restaurant");
    for (const role of SERVICE_ROLES) {
      const them = await permissionsForUser(service[role]!);
      assert.ok(!them.permissions.has(P.RESTAURANT_REPORTS), `${role}: no Restaurant Reports (the pages' guard, the export's 403)`);
      assert.ok(!them.permissions.has(P.VIEW_COST), `${role}: no View Cost`);
      if (on) assert.equal(them.serviceOnly, true, `${role}: Service only, so the back office redirects them`);
    }
  });

  test("a Service role ticked for Restaurant Reports by hand still doesn't get it", async () => {
    const ticked = await permissionsForUser(user.tickedWaiter);
    if (await isModuleEnabled("restaurant")) {
      assert.ok(!ticked.permissions.has(P.RESTAURANT_REPORTS));
      assert.ok(ticked.withheld.has(P.RESTAURANT_REPORTS), "withheld: Service only");
    }
  });
});

// Step 12, regression: with the module switched off (on the copy, put back
// after), Reports don't exist — the pages are a 404, the export answers 404
// before it looks at anyone's sign-in, and the Z-report reprint is refused.
const is404 = (error: unknown) => (error as { digest?: string } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";

describe("Module off: Restaurant Reports don't exist (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("the Reports pages (and Prep times): a 404", async () => {
    await assert.rejects(guardPage(P.RESTAURANT_REPORTS), (error) => is404(error));
  });

  test("the export: 404 for every tab, signed in or not", async () => {
    for (const tab of ["overview", "dishes", "waiters", "tables", "order-types", "payments", "waste", "voids", "shifts", "nonsense"]) {
      const response = await exportReport(new Request(`http://localhost/restaurant/reports/export/${tab}`), tab);
      assert.equal(response.status, 404, tab);
    }
  });

  test("the Z-report reprint: refused, nothing printed", async () => {
    const jobs = await prisma.printJob.count();
    assert.deepEqual(await reprintZReport("any-session"), { ok: false, error: "The Restaurant module is turned off." });
    assert.equal(await prisma.printJob.count(), jobs);
  });
});
