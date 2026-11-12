// Run with: npx tsx --test modules/restaurant/__tests__/serviceAccess.test.ts
// Part 6f Step 5, without a database: which pages a Service-level user may
// open (everything else is the back office), which permissions such a role
// keeps, and — from the source — that the proxy redirects them, actions
// answer "Not allowed", and the back office's buttons aren't rendered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectivePermissions, isServicePath, SERVICE_PERMISSIONS } from "../lib/serviceAccess";

test("service pages: sign-in, the touch POS and Tables, the kitchen display, the Classic floor and orders, what they print", () => {
  for (const path of [
    "/",
    "/api/auth/session",
    "/pos",
    "/pos/floor",
    "/pos/receipt/abc",
    "/restaurant/kitchen",
    "/restaurant/floor",
    "/restaurant/orders",
    "/restaurant/orders/ord_1",
    "/restaurant/tables",
    "/restaurant/bill/ord_1",
    "/restaurant/kot/k1",
    "/restaurant/receipt/s1",
    "/restaurant/settings/approval-pin",
    "/restaurant/settings/floor/image/area1",
    "/uploads/floor/a.png",
    "/customer-display",
    "/_next/static/chunk.js",
  ])
    assert.ok(isServicePath(path), path);
});

test("the back office: dashboard, settings, products, reports, food, retail pages — blocked", () => {
  for (const path of [
    "/dashboard",
    "/settings",
    "/settings/restaurant/staff",
    "/products",
    "/products/create",
    "/reports",
    "/reports/sale",
    "/restaurant",
    "/restaurant/food",
    "/restaurant/food/waste",
    "/restaurant/digital-menu",
    "/restaurant/settings/pos",
    "/restaurant/settings/floor",
    "/restaurant/tables/t1/qr",
    "/restaurant/qr-codes",
    "/sales",
    "/sales/s1/pdf",
    "/purchases",
    "/peoples/users",
    "/roles",
    "/profile",
    "/posx",
    "/restaurant/kitchenette",
  ])
    assert.ok(!isServicePath(path), path);
});

test("a Service-level role keeps the service permissions only (module on); back office or module off: everything", () => {
  const granted = ["Manage Orders", "Settle Bill", "Manage Products", "Restaurant Dashboard", "Manage Sale"];
  assert.deepEqual(effectivePermissions(granted, "SERVICE", true), { serviceOnly: true, permissions: ["Manage Orders", "Settle Bill"], withheld: ["Manage Products", "Restaurant Dashboard", "Manage Sale"] });
  assert.deepEqual(effectivePermissions(granted, "BACK_OFFICE", true), { serviceOnly: false, permissions: granted, withheld: [] });
  assert.deepEqual(effectivePermissions(granted, "SERVICE", false), { serviceOnly: false, permissions: granted, withheld: [] }, "module off: retail unchanged");
  for (const back of ["Manage Products", "Manage Setting", "Manage Users", "Manage Food", "Manage Tables", "Restaurant Settings", "Restaurant Reports", "Manage Floor Plan", "Manage Reports"])
    assert.ok(!SERVICE_PERMISSIONS.includes(back as never), back);
});

const src = (file: string) => readFileSync(file, "utf8");

test("blocked on the server: the proxy redirects Service-level users home; actions answer 'Not allowed'", () => {
  const proxy = src("proxy.ts");
  assert.match(proxy, /if \(user\?\.id && user\.accessLevel === "SERVICE" && !isServicePath\(pathname\)\) \{/);
  assert.match(proxy, /if \(!\(await isModuleEnabled\("restaurant"\)\)\) return null;/, "module off: no redirect");
  const auth = src("auth.ts");
  assert.match(auth, /token\.al = /, "the access level is read again on each look at the session");
  assert.match(auth, /session\.user\.accessLevel = token\.al;/);
  const perms = src("lib/auth/permissions.server.ts");
  assert.match(perms, /if \(current\.withheld\.has\(permission\) \|\| \(current\.serviceOnly && !isServicePermission\(permission\)\)\) \{\s*return \{ error: NOT_ALLOWED \};/);
  assert.match(perms, /permissions: new Set\(access\.permissions\)/, "every page, button and action sees the cut-down set");
});

test("hidden buttons aren't rendered: Back office only for back-office roles; no search, New or scan in the back office's bar for staff", () => {
  const header = src("modules/restaurant/components/pos/PosHeader.tsx");
  assert.match(header, /export function BackOfficeKey\(\) \{\s*const session = usePosSession\(\);\s*if \(!session\.leaveHref\) return null;/);
  assert.match(src("modules/restaurant/components/pos/PosFloor.tsx"), /<BackOfficeKey \/>/);
  assert.match(src("modules/restaurant/pages/PosPage.tsx"), /backOffice: !current\.serviceOnly/);
  assert.match(src("modules/restaurant/pages/PosFloorPage.tsx"), /leaveHref=\{current\.serviceOnly \? null :/);
  for (const file of ["OrderPos", "PosFloor", "RestaurantPos"])
    assert.match(src(`modules/restaurant/components/pos/${file}.tsx`), /\{ label: "Back office", onClick: session\.exit, hidden: !session\.leaveHref \}/, file);
  const topbar = src("components/layout/Topbar.tsx");
  assert.match(topbar, /\) : serviceOnly \? \(/, "no search for staff");
  assert.match(topbar, /\{!quiet && \(/, "no New");
  assert.match(topbar, /\{!serviceOnly && \(\s*<CameraScanButton/);
  assert.match(topbar, /\{serviceHref && \(\s*<Link\s*href=\{serviceHref\}/, "Service for back-office roles");
  assert.doesNotMatch(topbar, />Administrator</, "the role's own name under the user");
  assert.match(src("components/layout/nav-data.ts"), /\(!serviceOnly \|\| isServicePath\(href\)\)/);
});
