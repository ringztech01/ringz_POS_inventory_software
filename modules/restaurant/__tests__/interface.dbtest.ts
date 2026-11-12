// Part 6f Step 1 against a real database (a throwaway copy): the business's
// restaurant view (Service by default) and a device's own, each change in
// the audit log; the counts the Interface page shows. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/interface.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveView, routesFor } from "../lib/serviceRoutes";
import { getInterfaceSettings, setDeviceInterface, setRestaurantInterface } from "../server/services/interface";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const bar = randomUUID();
const tablet = randomUUID();
let userId = "";

describe("Restaurant view (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.device.createMany({ data: [{ id: bar, name: "Bar PC" }, { id: tablet, name: "Tablet 1" }] });
  });
  after(async () => {
    await prisma.device.deleteMany({ where: { id: { in: [bar, tablet] } } });
    await prisma.$disconnect();
  });

  test("the migration: every business starts on Service; devices follow it", async () => {
    const row = await prisma.businessSetting.findUnique({ where: { id: "default" }, select: { restaurantInterface: true } });
    assert.equal(row?.restaurantInterface ?? "SERVICE", "SERVICE");
    assert.equal(await prisma.device.count({ where: { restaurantInterface: { not: null } } }), 0);
  });

  test("Classic for the business: saved, logged once (from → to), every device without its own follows", async () => {
    const before = await prisma.auditLog.count({ where: { action: "restaurant.interface.set" } });
    assert.deepEqual(await setRestaurantInterface("CLASSIC", userId), { ok: true, changed: true });
    assert.deepEqual(await setRestaurantInterface("CLASSIC", userId), { ok: true, changed: false }, "the same again: nothing to log");
    const logs = await prisma.auditLog.findMany({ where: { action: "restaurant.interface.set" }, orderBy: { createdAt: "desc" }, take: 1 });
    assert.equal(await prisma.auditLog.count({ where: { action: "restaurant.interface.set" } }), before + 1);
    assert.deepEqual([logs[0].userId, logs[0].meta], [userId, { from: "SERVICE", to: "CLASSIC" }]);
    const business = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantInterface: true } });
    const device = await prisma.device.findUniqueOrThrow({ where: { id: tablet }, select: { restaurantInterface: true } });
    assert.equal(routesFor(resolveView(business, device)).tables(), "/restaurant/floor");
  });

  test("a device keeps its own (the Bar PC on Service while the business is Classic), back to the business with null", async () => {
    assert.deepEqual(await setDeviceInterface({ deviceId: bar, view: "SERVICE" }, userId), { ok: true });
    const business = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantInterface: true } });
    const view = async (id: string) => resolveView(business, await prisma.device.findUniqueOrThrow({ where: { id }, select: { restaurantInterface: true } }));
    assert.deepEqual([await view(bar), await view(tablet)], ["SERVICE", "CLASSIC"], "the device's own wins");
    const settings = await getInterfaceSettings(bar);
    assert.deepEqual([settings.view, settings.thisDevice, settings.overrides], ["CLASSIC", { id: bar, name: "Bar PC", view: "SERVICE" }, { service: 1, classic: 0 }]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "device.interface.set", entityId: bar }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(log.meta, { device: "Bar PC", from: "BUSINESS", to: "SERVICE" });

    assert.deepEqual(await setDeviceInterface({ deviceId: bar, view: null }, userId), { ok: true });
    assert.equal(await view(bar), "CLASSIC");
    assert.deepEqual(await setDeviceInterface({ deviceId: randomUUID(), view: "CLASSIC" }, userId), { ok: false, error: "That device is no longer listed — refreshed." });
    await setRestaurantInterface("SERVICE", userId);
  });
});
