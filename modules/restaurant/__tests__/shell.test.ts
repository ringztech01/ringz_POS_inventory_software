// Run with: npx tsx --test modules/restaurant/__tests__/shell.test.ts
// The Restaurant module in the app shell: permissions merged through the
// registry, the sidebar group and the Role-form groups — and none of it
// showing while the module is off.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSIONS, PERMISSIONS, permissionGroups, type Permission } from "@/lib/permissions";
import { NAV_PERMISSIONS, findOpenGroupForPath, resolveBreadcrumb, visibleNav } from "@/components/layout/nav-data";
import { Prisma } from "@prisma/client";
import { RESTAURANT_PERMISSIONS, restaurantModule } from "../manifest";

const RESTAURANT = Object.values(RESTAURANT_PERMISSIONS);
const CORE = ALL_PERMISSIONS.slice(0, 28);
const ON = ["restaurant"];
const OFF: string[] = [];
const keys = (permissions: Iterable<Permission>, modules: string[]) =>
  visibleNav(new Set(permissions), modules).map((item) => item.key);
const restaurantGroup = (permissions: Iterable<Permission>) =>
  visibleNav(new Set(permissions), ON).find((item) => item.key === "restaurant");

describe("permissions", () => {
  test("the 13 restaurant permissions come after the core 28, with matching keys", () => {
    assert.equal(ALL_PERMISSIONS.length, 41);
    assert.deepEqual(ALL_PERMISSIONS.slice(28), RESTAURANT);
    assert.equal(CORE[27], "Open Drawer");
    assert.equal(PERMISSIONS.KITCHEN_DISPLAY, "Kitchen Display");
    assert.equal(PERMISSIONS.MANAGE_KITCHEN, "Manage Kitchen");
    assert.equal(PERMISSIONS.MANAGE_SALE, "Manage Sale");
    assert.equal(new Set(ALL_PERMISSIONS).size, 41, "no string is shared with the core set");
    assert.ok(CORE.every((p) => !RESTAURANT.includes(p as (typeof RESTAURANT)[number])));
  });

  test("Role form: off shows only the core 28; on adds a Restaurant group", () => {
    assert.deepEqual(permissionGroups(OFF), [{ label: null, permissions: CORE }]);
    assert.deepEqual(permissionGroups(ON), [
      { label: null, permissions: CORE },
      { label: "Restaurant", permissions: RESTAURANT },
    ]);
  });
});

describe("sidebar", () => {
  test("off: no Restaurant group, even for a user with every permission; the rest unchanged", () => {
    const off = keys(ALL_PERMISSIONS, OFF);
    assert.ok(!off.includes("restaurant"));
    assert.deepEqual(off, keys(CORE, OFF));
    assert.deepEqual(keys(ALL_PERMISSIONS, ON).filter((key) => key !== "restaurant"), off);
  });

  test("on: shown after Sales, with all 10 links for the admin", () => {
    const on = keys(ALL_PERMISSIONS, ON);
    assert.equal(on[on.indexOf("sales") + 1], "restaurant");
    assert.deepEqual(
      restaurantGroup(ALL_PERMISSIONS)?.children?.map((child) => child.label),
      ["Dashboard", "Floor", "Orders", "Kitchen", "Food", "Tables", "Digital menu", "Prep times", "Stations", "Approval PIN"],
    );
  });

  test("on: needs at least one restaurant permission; links follow the user's permissions", () => {
    assert.equal(restaurantGroup(CORE), undefined);
    assert.deepEqual(restaurantGroup([PERMISSIONS.KITCHEN_DISPLAY])?.children?.map((c) => c.href), ["/restaurant/kitchen"]);
    assert.deepEqual(restaurantGroup([PERMISSIONS.MANAGE_FOOD])?.children?.map((c) => c.href), [
      "/restaurant/food",
      "/restaurant/digital-menu",
    ]);
    // Tables shows for either of its permissions; Floor for anyone working the floor.
    assert.deepEqual(restaurantGroup([PERMISSIONS.MANAGE_RESERVATIONS])?.children?.map((c) => c.href), ["/restaurant/floor", "/restaurant/tables"]);
    assert.deepEqual(restaurantGroup([PERMISSIONS.RESTAURANT_DASHBOARD])?.children?.map((c) => c.href), ["/restaurant", "/restaurant/floor"]);
    // Part 4: Prep times (Restaurant Reports) and Stations (Restaurant Settings), sidebar only.
    assert.deepEqual(restaurantGroup([PERMISSIONS.RESTAURANT_REPORTS])?.children?.map((c) => [c.label, c.href]), [["Prep times", "/restaurant/reports/prep-times"]]);
    assert.deepEqual(restaurantGroup([PERMISSIONS.RESTAURANT_SETTINGS])?.children?.map((c) => [c.label, c.href]), [["Stations", "/restaurant/settings/stations"]]);
    // Part 6: Approval PIN (Approve Discount, or Approve Waste), sidebar only.
    assert.deepEqual(restaurantGroup([PERMISSIONS.APPROVE_DISCOUNT])?.children?.map((c) => [c.label, c.href]), [["Approval PIN", "/restaurant/settings/approval-pin"]]);
    // Waste: Food (its Waste tab) for Log Waste or Approve Waste.
    assert.deepEqual(restaurantGroup([PERMISSIONS.APPROVE_WASTE])?.children?.map((c) => [c.label, c.href]), [
      ["Food", "/restaurant/food"],
      ["Approval PIN", "/restaurant/settings/approval-pin"],
    ]);
    assert.deepEqual(restaurantGroup([PERMISSIONS.LOG_WASTE])?.children?.map((c) => [c.label, c.href]), [["Food", "/restaurant/food"]]);
    assert.equal(PERMISSIONS.LOG_WASTE, "Log Waste");
    assert.deepEqual(restaurantGroup([PERMISSIONS.MANAGE_KITCHEN]), undefined, "Manage Kitchen alone opens no page");
  });

  test("the restaurant header keeps the design's seven tabs (sidebar-only links left out)", () => {
    assert.deepEqual(
      restaurantModule.nav.filter((tab) => tab.header !== false).map((tab) => tab.label),
      ["Dashboard", "Floor", "Orders", "Kitchen", "Food", "Tables", "Digital menu"],
    );
  });

  test("open group, breadcrumb and link permissions for restaurant paths", () => {
    assert.equal(findOpenGroupForPath("/restaurant/kitchen"), "restaurant");
    assert.deepEqual(resolveBreadcrumb("/restaurant"), { section: "Restaurant", title: "Dashboard" });
    assert.deepEqual(resolveBreadcrumb("/restaurant/digital-menu"), { section: "Restaurant", title: "Digital menu" });
    assert.deepEqual(resolveBreadcrumb("/restaurant/reports/prep-times"), { section: "Restaurant", title: "Prep times" });
    assert.deepEqual(NAV_PERMISSIONS["/restaurant/settings/stations"], [PERMISSIONS.RESTAURANT_SETTINGS]);
    assert.deepEqual(NAV_PERMISSIONS["/restaurant/tables"], [PERMISSIONS.MANAGE_TABLES, PERMISSIONS.MANAGE_RESERVATIONS]);
    assert.equal(NAV_PERMISSIONS["/sales"], PERMISSIONS.MANAGE_SALE);
    // Core paths resolve as before.
    assert.deepEqual(resolveBreadcrumb("/sales"), { section: "Sales", title: "Sales" });
  });
});

describe("manifest", () => {
  test("every link's permission and the settings permission are the module's own", () => {
    for (const link of restaurantModule.nav) {
      assert.ok(link.permissions.length > 0, link.href);
      for (const permission of link.permissions) assert.ok(RESTAURANT.includes(permission), link.href);
    }
    assert.equal(restaurantModule.toggle.permission, "Restaurant Settings");
  });

  test("isEnabled reads the flag the Settings switch saves", () => {
    const settings = {
      restaurantEnabled: false,
      restaurantReservedWindowMinutes: 60,
      restaurantBookingGapMinutes: 120,
      restaurantManualCleaning: true,
      restaurantServiceChargePercent: new Prisma.Decimal(10),
      restaurantDiscountLimitPercent: new Prisma.Decimal(10),
      restaurantWarehouseId: null,
      restaurantWasteApprovalLimit: new Prisma.Decimal(0),
      restaurantWasteAmberPercent: new Prisma.Decimal(5),
      restaurantWasteRedPercent: new Prisma.Decimal(10),
    };
    const flag = restaurantModule.toggle.setting;
    assert.equal(restaurantModule.isEnabled({ ...settings, [flag]: true }), true);
    assert.equal(restaurantModule.isEnabled({ ...settings, [flag]: false }), false);
  });
});
