// Run with: npx tsx --test modules/restaurant/__tests__/serviceRoutes.test.ts
// Part 6f Step 1: the one place that decides which restaurant screens the
// app uses — Service (PIN, touch Tables, Restaurant POS) or Classic (Floor,
// Table order, retail POS) — the device's own view first, then the business's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_VIEW, resolveServiceRoutes, resolveView, routesFor } from "../lib/serviceRoutes";

test("the device's own view wins; else the business's; else Service", () => {
  assert.equal(resolveView({ restaurantInterface: "SERVICE" }, { restaurantInterface: "CLASSIC" }), "CLASSIC");
  assert.equal(resolveView({ restaurantInterface: "CLASSIC" }, { restaurantInterface: null }), "CLASSIC");
  assert.equal(resolveView({ restaurantInterface: "CLASSIC" }, null), "CLASSIC");
  assert.equal(resolveView(null, null), "SERVICE");
  assert.equal(DEFAULT_VIEW, "SERVICE");
});

test("Service: the touch Tables screen, the Restaurant POS with the order", () => {
  const r = resolveServiceRoutes({ restaurantInterface: "SERVICE" }, null);
  assert.equal(r.view, "SERVICE");
  assert.equal(r.tables(), "/pos/floor");
  assert.equal(r.tables({ areaId: "a1", from: "o9" }), "/pos/floor?area=a1&from=o9");
  assert.equal(r.order("o9"), "/pos?order=o9");
  assert.equal(r.order("o9", { pay: true }), "/pos?order=o9&pay=1");
  assert.equal(r.pos, "/pos");
});

test("Classic: Restaurant › Floor, the Table order page, the retail POS", () => {
  const r = routesFor("CLASSIC");
  assert.equal(r.tables(), "/restaurant/floor");
  assert.equal(r.tables({ areaId: "a1", from: "o9" }), "/restaurant/floor?area=a1", "no POS 'back' on the Classic floor");
  assert.equal(r.order("o9", { pay: true }), "/restaurant/orders/o9");
  assert.equal(r.pos, "/pos");
});

test("odd ids are escaped", () => {
  assert.equal(routesFor("SERVICE").tables({ areaId: "a b&c" }), "/pos/floor?area=a%20b%26c");
  assert.equal(routesFor("CLASSIC").order("x/y"), "/restaurant/orders/x%2Fy");
});

// A file without its comment lines.
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

test("no screen hard-codes a view: the tables and order links all go through the resolver", () => {
  const files = [
    "modules/restaurant/components/floor/FloorBoard.tsx",
    "modules/restaurant/components/floor/NewTakeawayButton.tsx",
    "modules/restaurant/components/kitchen/KitchenBoard.tsx",
    "modules/restaurant/components/reservations/ReservationDetailsModal.tsx",
    "modules/restaurant/components/dashboard/DashboardLists.tsx",
    "modules/restaurant/components/sales/SaleOrderLink.tsx",
    "modules/restaurant/components/pos/OrderPos.tsx",
    "modules/restaurant/components/pos/PosFloor.tsx",
    "modules/restaurant/components/pos/PosSession.tsx",
    "modules/restaurant/components/pos/RestaurantPos.tsx",
    "modules/restaurant/pages/DashboardPage.tsx",
    "modules/restaurant/pages/OrderPage.tsx",
    "modules/restaurant/pages/OrderNotFound.tsx",
  ];
  const hardCoded = files.filter((file) => /["'`]\/pos\/floor|\/pos\?order=|["'`]\/restaurant\/floor["'`?]|\/restaurant\/orders\/\$\{/.test(code(file)));
  assert.deepEqual(hardCoded, []);
});

test("the settings are guarded on the server: the module on and Manage Setting, page and actions", () => {
  const page = readFileSync("modules/restaurant/pages/InterfaceSettingsPage.tsx", "utf8");
  assert.match(page, /await requireRestaurant\(\);\s*const denied = await pageGuard\(PERMISSIONS\.MANAGE_SETTING\);/);
  assert.match(readFileSync("app/(dashboard)/settings/restaurant/interface/page.tsx", "utf8"), /pages\/InterfaceSettingsPage/);
  const actions = readFileSync("modules/restaurant/server/actions/interface.ts", "utf8");
  assert.equal((actions.match(/await requireCorePermission\(PERMISSIONS\.MANAGE_SETTING\)/g) ?? []).length, 2);
  assert.match(readFileSync("app/(dashboard)/settings/devices/actions.ts", "utf8"), /await requirePermission\(PERMISSIONS\.MANAGE_SETTING\)/);
  assert.match(readFileSync("app/(dashboard)/settings/devices/page.tsx", "utf8"), /permissions\.has\(PERMISSIONS\.MANAGE_SETTING\)/);
});
