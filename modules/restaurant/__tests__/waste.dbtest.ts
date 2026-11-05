// Waste (services/waste.ts logWasteEntry / voidWasteEntry) against a real
// database: stock lines through resolveStockLines, the cost as logged, the
// approval limit and PIN, order lines, voids that put back exactly the saved
// lines, and races. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/waste.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import type { LogWasteInput } from "../schemas/waste";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";
import { setApprovalPin, WRONG_PIN } from "../server/services/approvalPins";
import { getWasteApprovers } from "../server/queries/approvers";
import { logWasteEntry, previewWaste, voidWasteEntry, WASTE_ITEM_GONE, type LogWasteResult } from "../server/services/waste";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let adminId = "";
let loggerId = "";
let wasteApproverId = "";
let discountOnlyId = "";
let warehouseId = "";
let areaId = "";
const id: Record<"jollof" | "chapman" | "rice" | "chicken" | "fanta" | "retail", string> = { jollof: "", chapman: "", rice: "", chicken: "", fanta: "", retail: "" };
const unitOf: Record<string, string> = {};

const stock = async (productId: string) => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).quantity;
const allStock = () => prisma.productStock.findMany({ orderBy: { id: "asc" }, select: { id: true, quantity: true } });
const log = (key: keyof typeof id, qty: string, extra: Partial<LogWasteInput> = {}) =>
  logWasteEntry({ productId: id[key], qty, unit: unitOf[key], reason: "BURNT", note: "", ...extra }, loggerId);
const ok = (r: LogWasteResult) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const entryOf = (entryId: string) => prisma.wasteEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: { orderBy: { productId: "asc" } } } });
const linesOf = async (entryId: string) => (await entryOf(entryId)).lines.map((l) => [l.productId, l.qty.toString(), l.unitCost.toFixed(2), l.lineCost.toFixed(2)]);
async function user(name: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { name: `chk ${name} ${Date.now()}`, permissions: { create: permissions.map((permission) => ({ permission })) } }, select: { id: true } });
  return (await prisma.user.create({ data: { firstName: name, lastName: "Check", email: `chk-${name}-${Date.now()}@example.test`, password: "x", roleId: role.id }, select: { id: true } })).id;
}

describe("Waste (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    loggerId = await user("Logger", ["Log Waste"]);
    wasteApproverId = await user("Approver", ["Approve Waste"]);
    discountOnlyId = await user("Discounter", ["Approve Discount"]);
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantWarehouseId: warehouseId }, update: { restaurantWarehouseId: warehouseId, restaurantWasteApprovalLimit: 0, restaurantServiceChargePercent: 10 } });
    if (!(await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null } }))) {
      await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true } });
    }
    areaId = (await prisma.diningArea.create({ data: { name: "Waste check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const grams = (await prisma.unit.create({ data: { name: `WTg${Date.now()}` } })).id;
    const pieces = (await prisma.unit.create({ data: { name: `WTpc${Date.now()}` } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Waste check" }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, cost: string | null, unitId: string, productType: "MENU_ITEM" | "INGREDIENT" | "STANDARD", quantity: number) => {
      const product = await prisma.product.create({ data: { name: `WT ${key}`, code: `WT-${key}-${Date.now()}`, price: "10", cost, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType }, include: { unit: true } });
      id[key] = product.id;
      unitOf[key] = product.unit.name;
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity } });
    };
    await make("jollof", "9.99", pieces, "MENU_ITEM", 5);
    await make("chapman", "2.00", pieces, "MENU_ITEM", 50);
    await make("rice", "0.02", grams, "INGREDIENT", 100000);
    await make("chicken", "3.50", pieces, "INGREDIENT", 1000);
    await make("fanta", "0.60", pieces, "INGREDIENT", 48);
    await make("retail", "1.00", pieces, "STANDARD", 10);
    await prisma.recipeLine.createMany({
      data: [
        { id: "wt-rice", menuItemId: id.jollof, ingredientId: id.rice, quantity: 250 },
        { menuItemId: id.jollof, ingredientId: id.chicken, quantity: 1 },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("a recipe item: its ingredients come out (resolveStockLines), each at its cost now", async () => {
    const before = { rice: await stock(id.rice), chicken: await stock(id.chicken), jollof: await stock(id.jollof) };
    const result = ok(await log("jollof", "2"));
    assert.equal(result.costSnapshot, "17.00");
    assert.deepEqual(await linesOf(result.id), [[id.chicken, "2", "3.50", "7.00"], [id.rice, "500", "0.02", "10.00"]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    assert.deepEqual([before.rice - (await stock(id.rice)), before.chicken - (await stock(id.chicken)), before.jollof - (await stock(id.jollof))], [500, 2, 0], "the ingredients, not the dish");
    const entry = await entryOf(result.id);
    assert.deepEqual(
      [entry.status, entry.reason, entry.qty.toString(), entry.unit, entry.warehouseId, entry.loggedById, entry.approvedById, entry.businessId, entry.version],
      ["ACTIVE", "BURNT", "2", unitOf.jollof, warehouseId, loggerId, null, "default", 0],
    );
  });

  test("a menu item without a recipe, or a raw ingredient: itself", async () => {
    const [chapman, fanta] = [await stock(id.chapman), await stock(id.fanta)];
    const a = ok(await log("chapman", "3", { reason: "DROPPED" }));
    const b = ok(await log("fanta", "2", { reason: "EXPIRED" }));
    assert.deepEqual([await linesOf(a.id), await linesOf(b.id)], [[[id.chapman, "3", "2.00", "6.00"]], [[id.fanta, "2", "0.60", "1.20"]]]);
    assert.deepEqual([chapman - (await stock(id.chapman)), fanta - (await stock(id.fanta))], [3, 2]);
    const other = ok(await log("fanta", "1", { reason: "OTHER", note: "Crate fell" }));
    assert.equal((await entryOf(other.id)).note, "Crate fell");
  });

  test("the cost is the one when logged: an ingredient's cost changing later doesn't change it", async () => {
    const result = ok(await log("jollof", "1"));
    await prisma.product.update({ where: { id: id.rice }, data: { cost: "0.05" } });
    try {
      const entry = await entryOf(result.id);
      assert.deepEqual([entry.costSnapshot.toFixed(2), entry.lines.find((l) => l.productId === id.rice)!.unitCost.toFixed(2)], ["8.50", "0.02"]);
      const preview = await previewWaste(id.jollof, "1");
      assert.ok(preview.ok && preview.total.toFixed(2) === "16.00", "a new log would cost the new price");
    } finally {
      await prisma.product.update({ where: { id: id.rice }, data: { cost: "0.02" } });
    }
  });

  test("refused, nothing written: another unit, a retail product, a deleted item, part units, not enough stock", async () => {
    const before = { stock: await allStock(), entries: await prisma.wasteEntry.count() };
    assert.deepEqual(await log("jollof", "1", { unit: "kg" }), { ok: false, error: `WT jollof is counted in ${unitOf.jollof} — log it in ${unitOf.jollof}.` });
    assert.deepEqual(await log("retail", "1"), { ok: false, error: "Only menu items and ingredients are logged as waste." });
    assert.deepEqual(await log("chapman", "1.5"), { ok: false, error: "WT chapman is counted in whole units — waste a whole number of them." });
    await prisma.product.update({ where: { id: id.chapman }, data: { deletedAt: new Date() } });
    assert.deepEqual(await log("chapman", "1"), { ok: false, error: WASTE_ITEM_GONE });
    await prisma.product.update({ where: { id: id.chapman }, data: { deletedAt: null } });
    const chicken = await stock(id.chicken);
    const rice = await stock(id.rice);
    await prisma.productStock.updateMany({ where: { productId: id.chicken, warehouseId }, data: { quantity: 1 } });
    try {
      const short = await log("jollof", "2");
      assert.ok(!short.ok && /^Not enough stock for WT chicken in .+ \(have 1, selling 2\)\.$/.test(short.error), JSON.stringify(short));
      assert.equal(await stock(id.rice), rice, "the rice line rolled back with it");
    } finally {
      await prisma.productStock.updateMany({ where: { productId: id.chicken, warehouseId }, data: { quantity: chicken } });
    }
    assert.deepEqual(await allStock(), before.stock, "every stock row as it was");
    assert.equal(await prisma.wasteEntry.count(), before.entries, "no entry");
  });

  test("the approval limit: above it an approver's PIN (Approve Waste); a wrong one is refused and counted", async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteApprovalLimit: 10 } });
    try {
      assert.ok((await log("jollof", "1")).ok, "₦8.50: under the limit");
      const before = { entries: await prisma.wasteEntry.count(), rice: await stock(id.rice) };
      assert.deepEqual(await log("jollof", "2"), { ok: false, error: "Waste over ₦10.00 needs an approver's PIN.", needsApproval: true, limit: "₦10.00" });
      assert.deepEqual(await setApprovalPin(wasteApproverId, "4821"), { ok: true }, "Approve Waste can set a PIN");
      assert.ok((await getWasteApprovers()).some((a) => a.id === wasteApproverId));
      assert.deepEqual(await log("jollof", "2", { approval: { approverId: wasteApproverId, pin: "0000" } }), { ok: false, error: WRONG_PIN });
      assert.equal((await prisma.approvalPin.findUniqueOrThrow({ where: { userId: wasteApproverId } })).failedAttempts, 1, "the wrong try is kept");
      await setApprovalPin(discountOnlyId, "1111");
      assert.deepEqual(await log("jollof", "2", { approval: { approverId: discountOnlyId, pin: "1111" } }), { ok: false, error: "That person can't approve waste. Pick someone else." });
      assert.deepEqual([await prisma.wasteEntry.count(), await stock(id.rice)], [before.entries, before.rice], "nothing written");
      const approved = ok(await log("jollof", "2", { approval: { approverId: wasteApproverId, pin: "4821" } }));
      assert.equal((await entryOf(approved.id)).approvedById, wasteApproverId);
    } finally {
      await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteApprovalLimit: 0 } });
    }
  });

  test("from an order line: linked to it, out of its order's warehouse; another dish's line refused", async () => {
    const table = await prisma.table.create({ data: { name: `W${Date.now() % 1000}`, seats: 2, areaId, qrToken: newQrToken() }, select: { id: true } });
    const opened = await openTableOrder(table.id, adminId);
    assert.ok(opened.ok);
    const v = async () => (await prisma.order.findUniqueOrThrow({ where: { id: opened.orderId } })).version;
    assert.ok((await addLine({ orderId: opened.orderId, version: await v(), productId: id.jollof, modifierIds: [], note: null })).ok);
    assert.ok((await sendToKitchen(opened.orderId, await v(), adminId)).ok);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: opened.orderId }, select: { id: true } });
    const result = ok(await log("jollof", "1", { orderItemId: line.id, reason: "RETURNED_BY_GUEST" }));
    const entry = await entryOf(result.id);
    assert.deepEqual([entry.orderItemId, entry.warehouseId, entry.reason], [line.id, warehouseId, "RETURNED_BY_GUEST"]);
    assert.deepEqual(await log("chapman", "1", { orderItemId: line.id }), { ok: false, error: "That order line is for another dish." });
  });

  test("void: exactly the saved lines go back (even after the recipe changed); the entry is VOID; only once", async () => {
    const logged = ok(await log("jollof", "1"));
    const afterLog = { rice: await stock(id.rice), chicken: await stock(id.chicken) };
    await prisma.recipeLine.update({ where: { id: "wt-rice" }, data: { quantity: 400 } });
    try {
      const voided = await voidWasteEntry({ id: logged.id, reason: "Logged on the wrong dish", version: 0 }, adminId);
      assert.ok(voided.ok, JSON.stringify(voided));
      assert.deepEqual([(await stock(id.rice)) - afterLog.rice, (await stock(id.chicken)) - afterLog.chicken], [250, 1], "250 g as saved, not 400 g");
      const original = await entryOf(logged.id);
      const reversing = await entryOf(voided.id);
      assert.deepEqual([original.status, original.version, voided.version], ["VOID", 1, 1]);
      assert.deepEqual(
        [reversing.status, reversing.voidOfId, reversing.voidReason, reversing.loggedById, reversing.costSnapshot.toFixed(2)],
        ["VOID", logged.id, "Logged on the wrong dish", adminId, original.costSnapshot.toFixed(2)],
      );
      assert.deepEqual(await linesOf(voided.id), await linesOf(logged.id), "the same lines");
      const stockAfterVoid = await allStock();
      assert.deepEqual(await voidWasteEntry({ id: logged.id, reason: "again", version: 1 }, adminId), { ok: false, error: "That waste entry has already been voided — refreshed.", stale: true });
      assert.deepEqual(await voidWasteEntry({ id: voided.id, reason: "x", version: 0 }, adminId), { ok: false, error: "That's a VOID entry — it can't be voided itself." });
      assert.deepEqual(await allStock(), stockAfterVoid, "no stock moved by the refusals");
    } finally {
      await prisma.recipeLine.update({ where: { id: "wt-rice" }, data: { quantity: 250 } });
    }
    const other = ok(await log("fanta", "1"));
    assert.deepEqual(await voidWasteEntry({ id: other.id, reason: "x", version: 3 }, adminId), { ok: false, error: "That waste entry was changed by someone else — refreshed.", stale: true });
  });

  test("two voids of the same entry at once: exactly one goes through, the stock back once", async () => {
    for (let round = 0; round < 5; round++) {
      const logged = ok(await log("chicken", "3"));
      const before = await stock(id.chicken);
      const results = await Promise.all([1, 2].map(() => voidWasteEntry({ id: logged.id, reason: "race", version: 0 }, adminId)));
      assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
      assert.equal((await stock(id.chicken)) - before, 3, "back once");
      assert.equal(await prisma.wasteEntry.count({ where: { voidOfId: logged.id } }), 1);
    }
  });

  test("waste logged while a settle takes the same ingredient: both land, no lost update", async () => {
    for (let round = 0; round < 5; round++) {
      const table = await prisma.table.create({ data: { name: `WS${round}-${Date.now() % 1000}`, seats: 2, areaId, qrToken: newQrToken() }, select: { id: true } });
      const opened = await openTableOrder(table.id, adminId);
      assert.ok(opened.ok);
      const v = async () => (await prisma.order.findUniqueOrThrow({ where: { id: opened.orderId } })).version;
      assert.ok((await addLine({ orderId: opened.orderId, version: await v(), productId: id.jollof, modifierIds: [], note: null })).ok);
      assert.ok((await sendToKitchen(opened.orderId, await v(), adminId)).ok);
      const before = { rice: await stock(id.rice), chicken: await stock(id.chicken) };
      const [settled, wasted] = await Promise.all([
        settleOrder({ orderId: opened.orderId, version: await v(), payments: [{ paymentType: "CASH", amount: "100" }], tip: "0", idempotencyKey: randomUUID() }, adminId),
        log("jollof", "1"),
      ]);
      assert.ok(settled.ok && wasted.ok, JSON.stringify([settled, wasted]));
      assert.deepEqual([before.rice - (await stock(id.rice)), before.chicken - (await stock(id.chicken))], [500, 2], "the settle's 250 g + the waste's 250 g");
    }
  });

  test("stock: every waste entry's change is exactly its lines; nothing moves without an entry", async () => {
    // Over everything this file logged and voided: started − Σ ACTIVE lines + 0 for VOID pairs − settles' moves.
    const entries = await prisma.wasteEntry.findMany({ where: { productId: { in: Object.values(id) } }, include: { lines: true } });
    for (const entry of entries.filter((e) => e.status === "ACTIVE")) {
      assert.ok(entry.lines.length > 0);
      assert.ok(entry.lines.reduce((s, l) => s + Number(l.lineCost), 0).toFixed(2) === entry.costSnapshot.toFixed(2), "the snapshot is its lines' total");
    }
    for (const reversed of entries.filter((e) => e.voidOfId)) {
      const original = entries.find((e) => e.id === reversed.voidOfId)!;
      assert.deepEqual(
        reversed.lines.map((l) => [l.productId, l.qty.toString()]).sort(),
        original.lines.map((l) => [l.productId, l.qty.toString()]).sort(),
      );
    }
    const fanta = await stock(id.fanta);
    const fantaOut = entries.filter((e) => e.status === "ACTIVE").flatMap((e) => e.lines).filter((l) => l.productId === id.fanta).reduce((n, l) => n + Number(l.qty), 0);
    const fantaVoided = entries.filter((e) => e.status === "VOID" && !e.voidOfId).flatMap((e) => e.lines).filter((l) => l.productId === id.fanta).length;
    assert.equal(48 - fanta, fantaOut, `Fanta: 48 − ${fantaOut} wasted (${fantaVoided} voided lines back)`);
  });
});
