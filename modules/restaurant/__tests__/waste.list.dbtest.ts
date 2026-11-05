// Food › Waste's list (queries/waste.ts) and live cost (wasteCostPreview)
// against a real database: the period on the app's calendar, the filters,
// newest first, a page at a time; VOID entries shown on the entry they void,
// never as rows; the summary leaves voided and deleted waste out. Needs a
// throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/waste.list.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { appDateTime } from "../lib/time";
import { readWasteFilter, type WasteFilter } from "../lib/waste";
import { getWasteItemOptions, getWasteList, getWasteSummary, getWasteUsers } from "../server/queries/waste";
import { logWasteEntry, voidWasteEntry, wasteCostPreview } from "../server/services/waste";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// Days nothing else in the copy is logged on.
const DAY = "2025-03-10";
const DAY_BEFORE = "2025-03-09";
const EMPTY_DAY = "2025-03-11";
const stamp = Date.now();

const id: Record<"jollof" | "rice" | "chicken" | "fanta" | "retail", string> = { jollof: "", rice: "", chicken: "", fanta: "", retail: "" };
const unitOf: Record<string, string> = {};
const entry: Record<"burnt" | "expired" | "other" | "dropped" | "deleted", string> = { burnt: "", expired: "", other: "", dropped: "", deleted: "" };
let loggerA = "";
let loggerB = "";
let approver = "";

const filter = (over: Partial<WasteFilter> = {}): WasteFilter => ({ range: { from: DAY, to: DAY }, reason: null, userId: null, status: null, q: "", ...over });
const ids = async (f: WasteFilter, page = 1, perPage = 25) => (await getWasteList(f, page, perPage)).rows.map((r) => r.id);

async function user(name: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { name: `chk ${name} ${stamp}`, permissions: { create: permissions.map((permission) => ({ permission })) } }, select: { id: true } });
  return (await prisma.user.create({ data: { firstName: `WL${name}`, lastName: "Check", email: `chk-wl-${name}-${stamp}@example.test`, password: "x", roleId: role.id }, select: { id: true } })).id;
}

async function logAt(key: keyof typeof id, qty: string, reason: "BURNT" | "EXPIRED" | "OTHER" | "DROPPED", by: string, day: string, time: string, note = "") {
  const r = await logWasteEntry({ productId: id[key], qty, unit: unitOf[key], reason, note }, by);
  assert.ok(r.ok, JSON.stringify(r));
  await prisma.wasteEntry.update({ where: { id: r.id }, data: { createdAt: appDateTime(day, time) } });
  return r.id;
}

describe("Food › Waste list (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    loggerA = await user("Ada", ["Log Waste"]);
    loggerB = await user("Bayo", ["Log Waste"]);
    approver = await user("Chidi", ["Approve Waste"]);
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantWarehouseId: warehouseId }, update: { restaurantWarehouseId: warehouseId, restaurantWasteApprovalLimit: 0 } });
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const grams = (await prisma.unit.create({ data: { name: `WLg${stamp}` } })).id;
    const pieces = (await prisma.unit.create({ data: { name: `WLpc${stamp}` } })).id;
    const categoryId = (await prisma.category.create({ data: { name: `Waste list ${stamp}` }, select: { id: true } })).id;
    const make = async (key: keyof typeof id, name: string, cost: string, unitId: string, productType: "MENU_ITEM" | "INGREDIENT" | "STANDARD", quantity: number) => {
      const product = await prisma.product.create({ data: { name: `${name} ${stamp}`, code: `WL-${key}-${stamp}`, price: "10", cost, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType }, include: { unit: true } });
      id[key] = product.id;
      unitOf[key] = product.unit.name;
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity } });
    };
    await make("jollof", "WL Jollof", "9.99", pieces, "MENU_ITEM", 5);
    await make("rice", "WL Rice", "0.02", grams, "INGREDIENT", 100000);
    await make("chicken", "WL Chicken", "3.50", pieces, "INGREDIENT", 100);
    await make("fanta", "WL Fanta", "0.60", pieces, "INGREDIENT", 48);
    await make("retail", "WL Retail", "1.00", pieces, "STANDARD", 10);
    await prisma.recipeLine.createMany({
      data: [
        { menuItemId: id.jollof, ingredientId: id.rice, quantity: 250 },
        { menuItemId: id.jollof, ingredientId: id.chicken, quantity: 1 },
      ],
    });

    entry.expired = await logAt("fanta", "2", "EXPIRED", loggerB, DAY, "09:00");
    entry.burnt = await logAt("jollof", "2", "BURNT", loggerA, DAY, "12:00");
    entry.other = await logAt("fanta", "1", "OTHER", loggerA, DAY, "18:00", "Fridge door left open");
    // The last minutes of the day before, on the app's clock (22:30 UTC).
    entry.dropped = await logAt("chicken", "1", "DROPPED", loggerB, DAY_BEFORE, "23:30");
    entry.deleted = await logAt("fanta", "1", "BURNT", loggerA, DAY, "10:00");
    await prisma.wasteEntry.update({ where: { id: entry.deleted }, data: { deletedAt: new Date() } });
    const voided = await voidWasteEntry({ id: entry.other, reason: "Logged twice", version: 0 }, approver);
    assert.ok(voided.ok, JSON.stringify(voided));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("the day on the app's calendar, newest first; a voided entry is one row, deleted ones none", async () => {
    assert.deepEqual(await ids(filter()), [entry.other, entry.burnt, entry.expired]);
    assert.deepEqual(await ids(filter({ range: { from: DAY_BEFORE, to: DAY_BEFORE } })), [entry.dropped]);
    assert.deepEqual(await ids(filter({ range: { from: DAY_BEFORE, to: DAY } })), [entry.other, entry.burnt, entry.expired, entry.dropped]);
    assert.deepEqual(await ids(filter({ range: { from: EMPTY_DAY, to: EMPTY_DAY } })), []);
  });

  test("a row: as logged, with its stock lines, who approved it, and its void", async () => {
    const { rows } = await getWasteList(filter(), 1, 25);
    const burnt = rows.find((r) => r.id === entry.burnt)!;
    assert.deepEqual(
      [burnt.item.name, burnt.qty, burnt.unit, burnt.reason, burnt.cost, burnt.loggedBy, burnt.approvedBy, burnt.status, burnt.version, burnt.voided],
      [`WL Jollof ${stamp}`, "2", unitOf.jollof, "BURNT", "17.00", "WLAda Check", null, "ACTIVE", 0, null],
    );
    assert.deepEqual(
      burnt.lines.map((l) => [l.name, l.qty, l.unit, l.unitCost, l.lineCost]).sort(),
      [
        [`WL Chicken ${stamp}`, "2", unitOf.chicken, "3.50", "7.00"],
        [`WL Rice ${stamp}`, "500", unitOf.rice, "0.02", "10.00"],
      ],
    );
    const other = rows.find((r) => r.id === entry.other)!;
    assert.deepEqual([other.status, other.version, other.note, other.voided?.by, other.voided?.reason], ["VOID", 1, "Fridge door left open", "WLChidi Check", "Logged twice"]);
  });

  test("filters: reason, logged by, status, search by item name or code", async () => {
    assert.deepEqual(await ids(filter({ reason: "EXPIRED" })), [entry.expired]);
    assert.deepEqual(await ids(filter({ userId: loggerA })), [entry.other, entry.burnt]);
    assert.deepEqual(await ids(filter({ status: "VOID" })), [entry.other]);
    assert.deepEqual(await ids(filter({ status: "ACTIVE" })), [entry.burnt, entry.expired]);
    assert.deepEqual(await ids(filter({ q: "wl jollof" })), [entry.burnt]);
    assert.deepEqual(await ids(filter({ q: `WL-fanta-${stamp}` })), [entry.other, entry.expired]);
    assert.deepEqual(await ids(filter({ q: "WL Fanta", userId: loggerB })), [entry.expired]);
    // From the URL (readWasteFilter): an unknown user means everyone.
    const fromUrl = readWasteFilter({ from: DAY, reason: "BURNT", user: "not-a-user" }, [loggerA, loggerB]);
    assert.deepEqual(await ids(fromUrl), [entry.burnt]);
  });

  test("a page at a time, with the total", async () => {
    const second = await getWasteList(filter(), 2, 2);
    assert.deepEqual([second.total, second.rows.map((r) => r.id)], [3, [entry.expired]]);
  });

  test("the summary: the period's waste that stands, whatever the other filters; the reason that cost the most", async () => {
    assert.deepEqual(await getWasteSummary({ from: DAY, to: DAY }), { total: "18.20", count: 2, topReason: "BURNT", topReasonCost: "17.00" });
    assert.deepEqual(await getWasteSummary({ from: DAY_BEFORE, to: DAY_BEFORE }), { total: "3.50", count: 1, topReason: "DROPPED", topReasonCost: "3.50" });
    assert.deepEqual(await getWasteSummary({ from: DAY_BEFORE, to: DAY }), { total: "21.70", count: 3, topReason: "BURNT", topReasonCost: "17.00" });
    assert.deepEqual(await getWasteSummary({ from: EMPTY_DAY, to: EMPTY_DAY }), { total: "0.00", count: 0, topReason: null, topReasonCost: null });
  });

  test("the pickers: who has logged waste (not someone who only voided); menu items and ingredients with their units", async () => {
    const users = (await getWasteUsers()).map((u) => u.id);
    assert.ok(users.includes(loggerA) && users.includes(loggerB));
    assert.ok(!users.includes(approver));
    const items = await getWasteItemOptions();
    const mine = items.filter((i) => i.code.endsWith(String(stamp))).map((i) => [i.code, i.type, i.unit]);
    assert.deepEqual(mine.sort(), [
      [`WL-chicken-${stamp}`, "INGREDIENT", unitOf.chicken],
      [`WL-fanta-${stamp}`, "INGREDIENT", unitOf.fanta],
      [`WL-jollof-${stamp}`, "MENU_ITEM", unitOf.jollof],
      [`WL-rice-${stamp}`, "INGREDIENT", unitOf.rice],
    ]);
  });

  test("the live cost: the server's numbers, the stock lines with units, and the approval limit", async () => {
    const preview = await wasteCostPreview(id.jollof, "2");
    assert.ok(preview.ok, JSON.stringify(preview));
    assert.deepEqual([preview.total, preview.unit, preview.needsApproval], ["17.00", unitOf.jollof, false]);
    assert.deepEqual(preview.lines.map((l) => [l.name, l.qty, l.unit]).sort(), [
      [`WL Chicken ${stamp}`, "2", unitOf.chicken],
      [`WL Rice ${stamp}`, "500", unitOf.rice],
    ]);
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteApprovalLimit: 10 } });
    try {
      const over = await wasteCostPreview(id.jollof, "2");
      assert.ok(over.ok && over.needsApproval && over.limit === "₦10.00", JSON.stringify(over));
      const under = await wasteCostPreview(id.fanta, "2");
      assert.ok(under.ok && !under.needsApproval, JSON.stringify(under));
    } finally {
      await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWasteApprovalLimit: 0 } });
    }
    const half = await wasteCostPreview(id.jollof, "0.5");
    assert.ok(!half.ok && /part of a unit/.test(half.error), JSON.stringify(half));
    const retail = await wasteCostPreview(id.retail, "1");
    assert.deepEqual(retail, { ok: false, error: "Only menu items and ingredients are logged as waste." });
    // Nothing was written by a preview.
    assert.equal(await prisma.wasteEntry.count({ where: { productId: id.retail } }), 0);
  });
});
