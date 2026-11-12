// Run with: npx tsx --test modules/restaurant/__tests__/staffRoles.test.ts
// Part 6f Step 2, without a database: each role's home screen, who may give
// someone a role, and (from the source) that the matrix and the user form
// enforce it on the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routesFor } from "../lib/serviceRoutes";
import { assignRoleProblem, homeHref, SYSTEM_ROLE_INFO, SYSTEM_ROLES } from "../lib/staffRoles";
import { unassignRoleProblem } from "@/lib/auth/roleRules";

const service = routesFor("SERVICE");
const classic = routesFor("CLASSIC");
const home = (homeScreen: "TABLES" | "BAR" | "CASHIER" | "KITCHEN", homeAreaId: string | null = null, homeStation: string | null = null) => ({ homeScreen, homeAreaId, homeStation });

test("the six built-in roles: only the Administrator and the Manager reach the back office by default", () => {
  assert.deepEqual(SYSTEM_ROLES, ["ADMINISTRATOR", "MANAGER", "CASHIER", "WAITER", "BARTENDER", "KITCHEN"]);
  assert.deepEqual(SYSTEM_ROLES.filter((r) => SYSTEM_ROLE_INFO[r].access === "BACK_OFFICE"), ["ADMINISTRATOR", "MANAGER"]);
  assert.deepEqual(SYSTEM_ROLES.map((r) => SYSTEM_ROLE_INFO[r].home), ["TABLES", "TABLES", "CASHIER", "TABLES", "BAR", "KITCHEN"]);
});

test("home screens: Waiter → Tables; Bartender → the bar's area with the bar tabs; Cashier → Pay and Split first; Kitchen → its station", () => {
  assert.equal(homeHref(home("TABLES"), service), "/pos/floor");
  assert.equal(homeHref(home("BAR", "area-bar"), service), "/pos/floor?area=area-bar&focus=bar");
  assert.equal(homeHref(home("CASHIER"), service), "/pos/floor?focus=pay");
  assert.equal(homeHref(home("KITCHEN", null, "KIT"), service), "/restaurant/kitchen?station=KIT");
  assert.equal(homeHref(home("KITCHEN"), service), "/restaurant/kitchen", "no station: all of them");
});

test("…in the Classic view, the Tables homes are Restaurant › Floor (on the area)", () => {
  assert.equal(homeHref(home("BAR", "area-bar"), classic), "/restaurant/floor?area=area-bar");
  assert.equal(homeHref(home("CASHIER"), classic), "/restaurant/floor");
});

test("only an Administrator gives the Administrator role (always) or a back-office role (module on), or moves an Administrator", () => {
  const admin = { isAdmin: true };
  const manager = { isAdmin: false };
  const adminRole = { isSystem: true, accessLevel: "BACK_OFFICE" as const };
  const managerRole = { isSystem: false, accessLevel: "BACK_OFFICE" as const };
  const waiterRole = { isSystem: false, accessLevel: "SERVICE" as const };
  assert.equal(assignRoleProblem(admin, adminRole, true), null);
  assert.equal(assignRoleProblem(admin, managerRole, true), null);
  assert.equal(assignRoleProblem(manager, waiterRole, true), null);
  assert.equal(assignRoleProblem(manager, adminRole, true), "Only an Administrator can give someone the Administrator role.");
  assert.equal(assignRoleProblem(manager, adminRole, false), "Only an Administrator can give someone the Administrator role.", "retail too");
  assert.equal(assignRoleProblem(manager, managerRole, true), "Only an Administrator can give someone back-office access.");
  assert.equal(assignRoleProblem(manager, managerRole, false), null, "module off: access levels don't apply");
  assert.equal(unassignRoleProblem(manager, { isSystem: true }), "Only an Administrator can change an Administrator's role.");
  assert.equal(unassignRoleProblem(manager, { isSystem: false }), null);
  assert.equal(unassignRoleProblem(admin, { isSystem: true }), null);
});

test("enforced on the server: the matrix page and its actions are the Administrator's; the user form checks every role change", () => {
  const page = readFileSync("modules/restaurant/pages/RoleMatrixPage.tsx", "utf8");
  assert.match(page, /await requireRestaurant\(\);\s*if \(!\(await isSystemAdmin\(await getCurrentUserPermissions\(\)\)\)\) return <ForbiddenState/);
  const actions = readFileSync("modules/restaurant/server/actions/staffRoles.ts", "utf8");
  assert.equal((actions.match(/const admin = await requireAdministrator\(\);\s*if \(admin\.error !== undefined\) return/g) ?? []).length, 2);
  const guard = readFileSync("modules/restaurant/server/guard.ts", "utf8");
  assert.match(guard.slice(guard.indexOf("export async function requireAdministrator")), /isSystemAdmin\(current\)/);
  const users = readFileSync("app/(dashboard)/peoples/users/actions.ts", "utf8");
  assert.match(users, /const createProblem = await roleChangeProblem\(roleId, null\);\s*if \(createProblem\) return/);
  assert.match(users, /const updateProblem = await roleChangeProblem\(roleId, existing\.roleId\);\s*if \(updateProblem\) return/);
  const roles = readFileSync("app/(dashboard)/roles/actions.ts", "utf8");
  assert.match(roles, /if \(role\.systemRole\) \{\s*return \{ ok: false, error: "Can't delete — it's one of the built-in staff roles\." \};/);
});
