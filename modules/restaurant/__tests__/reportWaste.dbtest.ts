// Restaurant Reports, Step 7, against a real database (a throwaway copy):
// waste logged the real way — a dish with a recipe (its ingredients come
// out), an ingredient on its own, one voided, a Kitchen Display remake —
// then the Waste report: ACTIVE waste only (the voided entry and its VOID
// reversal left out), by reason, item, ingredient, person and day; the
// remake apart; waste as a share of food cost with View Cost only. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportWaste.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { advanceLine } from "../server/services/kitchen";
import { logWasteEntry, voidWasteEntry } from "../server/services/waste";
import { remakeLine } from "../server/services/remake";
import { wasteKpis } from "../lib/reportWaste";
import { parseReportFilters } from "../server/queries/reports/filters";
import { getWasteReport } from "../server/queries/reports/waste";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Moved to 10 Sept 2025 (Lagos), a day with nothing else on the copy.
const DAY = "2025-09-10";
const at = (hhmm: string) => new Date(`2025-09-10T${hhmm}:00.000Z`);
let userId = "";
const id: Record<"stew" | "beef" | "oil" | "bread", string> = { stew: "", beef: "", oil: "", bread: "" };

describe("Reports waste (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Wunmi", lastName: "Waste", email: `wunmi-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantWarehouseId: warehouseId }, update: { restaurantWarehouseId: warehouseId, restaurantWasteApprovalLimit: 0, restaurantWasteAmberPercent: 5, restaurantWasteRedPercent: 10 } });
    await prisma.printerAssignment.deleteMany({ where: { role: "RECEIPT" } });
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Waste report check" }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, cost: string, type: "MENU_ITEM" | "INGREDIENT") => {
      id[key] = (await prisma.product.create({ data: { name: `RWS ${key}`, code: `RWS-${key}-${Date.now()}`, price: "20", cost, orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: type }, select: { id: true } })).id;
      await prisma.productStock.create({ data: { productId: id[key], warehouseId, quantity: 1000 } });
    };
    await make("stew", "999", "MENU_ITEM");
    await make("beef", "2.50", "INGREDIENT");
    await make("oil", "0.50", "INGREDIENT");
    await make("bread", "1.00", "INGREDIENT");
    await prisma.recipeLine.createMany({ data: [{ menuItemId: id.stew, ingredientId: id.beef, quantity: 2 }, { menuItemId: id.stew, ingredientId: id.oil, quantity: 1 }] });

    const log = async (productId: string, qty: string, reason: "BURNT" | "EXPIRED" | "OVERPRODUCTION", when: string) => {
      const done = await logWasteEntry({ productId, qty, reason, note: "" }, userId);
      assert.ok(done.ok, JSON.stringify(done));
      await prisma.wasteEntry.update({ where: { id: done.id }, data: { createdAt: at(when) } });
      return done.id;
    };
    // 2 stews burnt (₦11.00: beef 4, oil 2), 3 bread expired (₦3.00), 10 bread overproduced then voided.
    await log(id.stew, "2", "BURNT", "10:00");
    await log(id.bread, "3", "EXPIRED", "11:00");
    const voided = await log(id.bread, "10", "OVERPRODUCTION", "12:00");
    const entry = await prisma.wasteEntry.findUniqueOrThrow({ where: { id: voided }, select: { version: true } });
    assert.ok((await voidWasteEntry({ id: voided, reason: "Logged twice", version: entry.version }, userId)).ok);
    await prisma.wasteEntry.updateMany({ where: { voidOfId: voided }, data: { createdAt: at("12:05") } });

    // A remake: a stew being made, dropped, remade (₦5.50 of waste logged with it).
    const area = (await prisma.diningArea.create({ data: { name: "Waste report check", warehouseId }, select: { id: true } })).id;
    const table = await prisma.table.create({ data: { name: testTable("RWS1"), seats: 2, areaId: area, qrToken: newQrToken() }, select: { id: true } });
    const opened = await openTableOrder(table.id, userId);
    assert.ok(opened.ok);
    const v = async () => (await prisma.order.findUniqueOrThrow({ where: { id: opened.orderId }, select: { version: true } })).version;
    assert.ok((await addLine({ orderId: opened.orderId, version: await v(), productId: id.stew, modifierIds: [], note: null })).ok);
    assert.ok((await sendToKitchen(opened.orderId, await v(), userId)).ok);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: opened.orderId }, select: { id: true } });
    assert.ok((await advanceLine(line.id, "PENDING")).ok);
    const remade = await remakeLine({ itemId: line.id, qty: 1, reason: "DROPPED", note: "", approval: undefined }, userId);
    assert.ok(remade.ok, JSON.stringify(remade));
    // Both moved together, as they were made together.
    await prisma.wasteEntry.updateMany({ where: { orderItemId: line.id }, data: { createdAt: at("13:00") } });
    await prisma.orderItem.updateMany({ where: { remakeOfId: line.id }, data: { createdAt: at("13:00") } });
  });
  after(() => prisma.$disconnect());

  const report = async (withCost: boolean) => {
    const result = await getWasteReport(parseReportFilters({ from: DAY, to: DAY }, { dayStartMinutes: 0 }).window, { dayStartMinutes: 0, withCost });
    assert.ok(result.ok);
    return result.data;
  };

  test("ACTIVE waste only: by reason; the strip", async () => {
    const data = await report(false);
    assert.deepEqual(data.byReason.map((r) => [r.reason, r.count, r.cost.toFixed(2)]).sort(), [["BURNT", 1, "11.00"], ["DROPPED", 1, "5.50"], ["EXPIRED", 1, "3.00"]]);
    const k = wasteKpis({ byReason: data.byReason, foodCost: data.foodCost, amber: data.thresholds.amber, red: data.thresholds.red });
    assert.deepEqual([k.total, k.entries, k.topReason, k.share], ["19.50", 3, "BURNT", null], "no View Cost: no share");
    assert.equal(data.foodCost, null);
  });

  test("by item, by ingredient (the stock lines), by person, by day", async () => {
    const data = await report(false);
    const item = Object.fromEntries(data.byItem.map((r) => [r.key, [r.count, r.quantity.toString(), r.cost.toFixed(2)]]));
    assert.deepEqual([item[id.stew], item[id.bread]], [[2, "3", "16.50"], [1, "3", "3.00"]]);
    const ingredient = Object.fromEntries(data.byIngredient.map((r) => [r.key, [r.quantity.toString(), r.cost.toFixed(2)]]));
    assert.deepEqual([ingredient[id.beef], ingredient[id.oil], ingredient[id.bread]], [["6", "15.00"], ["3", "1.50"], ["3", "3.00"]]);
    assert.deepEqual(data.byUser.map((r) => [r.key, r.count, r.cost.toFixed(2)]), [[userId, 3, "19.50"]]);
    assert.deepEqual(data.byDay.map((d) => [d.day, d.cost.toFixed(2)]), [[DAY, "19.50"]]);
  });

  test("the remake, apart: the remade dish and the waste logged with it", async () => {
    const data = await report(false);
    assert.deepEqual(data.remakes.map((r) => [r.productId, r.lines, r.quantity, r.cost.toFixed(2)]), [[id.stew, 1, 1, "5.50"]]);
    assert.deepEqual([data.remakeCost.toFixed(2), data.remakeEntries], ["5.50", 1]);
  });

  test("with View Cost: food cost and waste as a share of it", async () => {
    const data = await report(true);
    assert.ok(data.foodCost !== null);
    assert.deepEqual([data.thresholds.amber.toString(), data.thresholds.red.toString()], ["5", "10"]);
  });
});
