// Waste Step 5 against a real database: the dashboard's Waste tile (the
// period's waste against the food cost of its billed orders, amber / red
// by the settings) and Top wasted items (last 7 days, top 5 by cost). Its
// own order is settled and its own waste logged; the numbers are checked
// as changes, whatever else the copy holds today. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/waste.dashboard.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePeriod } from "../lib/dashboard";
import { newQrToken } from "../lib/qrToken";
import { getTopWastedItems, getWasteKpi } from "../server/queries/dashboard";
import { openTableOrder } from "../server/services/floor";
import { sendToKitchen } from "../server/services/orderFlow";
import { addLine } from "../server/services/orderLines";
import { settleOrder } from "../server/services/settle";
import { logWasteEntry, voidWasteEntry } from "../server/services/waste";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const stamp = Date.now();
let adminId = "";
let areaId = "";
const id: Record<"stew" | "beef" | "oil", string> = { stew: "", beef: "", oil: "" };
let unitName = "";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const today = () => resolvePeriod("today");
const version = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).version;

describe("Dashboard waste (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({
      where: { id: "default" },
      create: { id: "default", restaurantWarehouseId: warehouseId },
      update: { restaurantWarehouseId: warehouseId, restaurantWasteApprovalLimit: 0, restaurantServiceChargePercent: 0, restaurantWasteAmberPercent: 5, restaurantWasteRedPercent: 10 },
    });
    if (!(await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null } }))) {
      await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true } });
    }
    if (!(await prisma.kitchenStation.findFirst({ where: { deletedAt: null, isActive: true } }))) {
      await prisma.kitchenStation.create({ data: { code: `WD${stamp % 1000}`, name: "Dashboard check", lateAfterMin: 15 } });
    }
    areaId = (await prisma.diningArea.create({ data: { name: `Waste dashboard ${stamp}`, warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unit = await prisma.unit.create({ data: { name: `WDu${stamp}` } });
    unitName = unit.name;
    const categoryId = (await prisma.category.create({ data: { name: `Waste dashboard ${stamp}` }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, price: string, cost: string | null, productType: "MENU_ITEM" | "INGREDIENT", quantity: number) => {
      const product = await prisma.product.create({ data: { name: `WD ${key} ${stamp}`, code: `WD-${key}-${stamp}`, price, cost, categoryId, brandId, unitId: unit.id, taxType: "EXCLUSIVE", productType, showOnMenu: true } });
      id[key] = product.id;
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity } });
    };
    // A stew: 2 beef (₦100) + 30 oil (₦1) = ₦230 of food per stew.
    await make("stew", "1000.00", null, "MENU_ITEM", 0);
    await make("beef", "1", "100.00", "INGREDIENT", 10000);
    await make("oil", "1", "1.00", "INGREDIENT", 100000);
    await prisma.recipeLine.createMany({
      data: [
        { menuItemId: id.stew, ingredientId: id.beef, quantity: 2 },
        { menuItemId: id.stew, ingredientId: id.oil, quantity: 30 },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("the tile: waste against the food cost of today's billed orders; voided waste left out", async () => {
    const before = await getWasteKpi(today());
    // 10 stews billed today → ₦2,300 of food.
    const table = await prisma.table.create({ data: { name: `WD${stamp % 1000}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
    const opened = await openTableOrder(table.id, adminId);
    assert.ok(opened.ok);
    for (let i = 0; i < 10; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await version(opened.orderId), productId: id.stew, modifierIds: [], note: null })).ok);
    assert.ok((await sendToKitchen(opened.orderId, await version(opened.orderId), adminId)).ok);
    const settled = await settleOrder({ orderId: opened.orderId, version: await version(opened.orderId), payments: [{ paymentType: "CASH", amount: "10000" }], tip: "0", idempotencyKey: randomUUID() }, adminId);
    assert.ok(settled.ok, JSON.stringify(settled));
    const billed = await getWasteKpi(today());
    assert.equal(D(billed.foodCost).minus(before.foodCost).toFixed(2), "2300.00");

    // ₦230 wasted (one stew), and ₦100 wasted then voided.
    const one = await logWasteEntry({ productId: id.stew, qty: "1", reason: "BURNT", note: "" }, adminId);
    assert.ok(one.ok, JSON.stringify(one));
    const undone = await logWasteEntry({ productId: id.beef, qty: "1", reason: "DROPPED", note: "" }, adminId);
    assert.ok(undone.ok);
    assert.ok((await voidWasteEntry({ id: undone.id, reason: "wrong", version: 0 }, adminId)).ok);
    const after = await getWasteKpi(today());
    assert.equal(D(after.cost).minus(before.cost).toFixed(2), "230.00");
    assert.equal(after.entries - before.entries, 1);
    assert.equal(after.foodCost, billed.foodCost);
    assert.equal(after.share, Number(D(after.cost).div(after.foodCost).times(100).toDecimalPlaces(1)));

    // Yesterday's period doesn't see today's.
    const yesterday = await getWasteKpi(resolvePeriod("yesterday"));
    const week = await getWasteKpi(resolvePeriod("7d"));
    assert.ok(D(week.cost).greaterThanOrEqualTo(D(after.cost).plus(yesterday.cost)));
  });

  test("the colour follows the settings", async () => {
    const kpi = await getWasteKpi(today());
    assert.ok(kpi.share !== null && kpi.share > 0, JSON.stringify(kpi));
    const set = (amber: number, red: number) => prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteAmberPercent: amber, restaurantWasteRedPercent: red } });
    try {
      await set(kpi.share + 1, kpi.share + 2);
      assert.equal((await getWasteKpi(today())).level, "ok");
      await set(Math.max(0, kpi.share - 0.5), kpi.share + 2);
      assert.equal((await getWasteKpi(today())).level, "amber");
      await set(0, Math.max(0, kpi.share - 0.5));
      assert.equal((await getWasteKpi(today())).level, "red");
    } finally {
      await set(5, 10);
    }
  });

  test("Top wasted items: the last 7 days by cost, five at most, voided waste left out", async () => {
    // 3 more stews burnt yesterday-ish (still in the 7 days): ₦690 more.
    const more = await logWasteEntry({ productId: id.stew, qty: "3", reason: "OVERPRODUCTION", note: "" }, adminId);
    assert.ok(more.ok);
    await prisma.wasteEntry.update({ where: { id: more.id }, data: { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
    // Outside the 7 days: left out.
    const old = await logWasteEntry({ productId: id.stew, qty: "1", reason: "BURNT", note: "" }, adminId);
    assert.ok(old.ok);
    await prisma.wasteEntry.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000) } });

    const { range, rows } = await getTopWastedItems();
    assert.ok(rows.length <= 5);
    assert.equal(range.to > range.from, true);
    const stew = rows.find((r) => r.productId === id.stew);
    assert.deepEqual(stew, { productId: id.stew, name: `WD stew ${stamp}`, code: `WD-stew-${stamp}`, quantity: "4", unit: unitName, entries: 2, cost: "920.00" });
    assert.ok(!rows.some((r) => r.productId === id.beef && r.cost !== "0.00"), "the voided beef isn't counted");
    // Highest cost first.
    for (let i = 1; i < rows.length; i++) assert.ok(D(rows[i - 1].cost).greaterThanOrEqualTo(rows[i].cost));
  });
});
