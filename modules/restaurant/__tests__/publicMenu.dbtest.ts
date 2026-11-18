// Part 8 Step 3 against a real database (a throwaway copy): the guest's
// menu. Its own area, table, groups and items, then loadPublicMenu as the
// page calls it:
//   - the token: a table's opens its menu; rotated, deleted or made up → the
//     "no longer active" message; a Bar point opens on Bar;
//   - states by the POS's rule (switched off, sold out by stock or recipe);
//     not on the menu or soft-deleted: never there;
//   - prices exactly as the POS's order screen shows them;
//   - the settings: menu off, sold out hidden, prices hidden;
//   - nothing back-office in what's sent (no cost, stock, staff, orders,
//     warehouse, other tables' codes); the live check is states only;
//   - module off: 404 everywhere.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/publicMenu.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { loadMenuStatuses, loadPublicMenu, type PublicMenuPage } from "../server/queries/publicMenu";
import { getMenu } from "../server/queries/orderScreen";
import { replaceQrToken } from "../server/services/tables";
import { GET as statusRoute } from "../server/routes/menuStatus";
import { GET as mediaRoute } from "../server/routes/menuMedia";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

const id: Record<"ok" | "off" | "out" | "recipeOut" | "hidden" | "deleted" | "drink" | "flour", string> = { ok: "", off: "", out: "", recipeOut: "", hidden: "", deleted: "", drink: "", flour: "" };
let warehouseId = "";
let areaId = "";
let tableId = "";
let token = "";
let barToken = "";
let takeawayToken = "";
let mediaDir = "";
const settingsBefore: { showSoldOut: boolean; showPrices: boolean; menuEnabled: boolean; callWaiterEnabled: boolean; requestBillEnabled: boolean; guestOrderingEnabled: boolean } = { showSoldOut: true, showPrices: true, menuEnabled: true, callWaiterEnabled: false, requestBillEnabled: false, guestOrderingEnabled: false };

const menu = async (t = token) => {
  const page = await loadPublicMenu(t);
  return page;
};
const asMenu = (page: PublicMenuPage) => {
  assert.equal(page.kind, "menu");
  return page as Extract<PublicMenuPage, { kind: "menu" }>;
};
const mine = (page: Extract<PublicMenuPage, { kind: "menu" }>) => page.items.filter((i) => Object.values(id).includes(i.id));
const keysOf = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
};

describe("The guest's digital menu (database copy)", { skip }, () => {
  let moduleWas = true;
  before(async () => {
    // On for this part (the copy may have it off): put back after.
    moduleWas = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true } });
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Public menu check", warehouseId }, select: { id: true } })).id;
    token = newQrToken();
    tableId = (await prisma.table.create({ data: { name: `PM${Date.now() % 100000}`, seats: 2, areaId, qrToken: token }, select: { id: true } })).id;
    barToken = newQrToken();
    takeawayToken = newQrToken();
    await prisma.qrPoint.createMany({ data: [{ name: "PM bar", qrToken: barToken, orderType: "BAR_TAB" }, { name: "PM counter", qrToken: takeawayToken, orderType: "TAKEAWAY" }] });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWarehouseId: warehouseId } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    Object.assign(settingsBefore, { showSoldOut: s.showSoldOut, showPrices: s.showPrices, menuEnabled: s.menuEnabled, callWaiterEnabled: s.callWaiterEnabled, requestBillEnabled: s.requestBillEnabled, guestOrderingEnabled: s.guestOrderingEnabled });
    // The guest buttons and ordering (Steps 6–7) off for this part, whatever the copy has.
    await prisma.menuSettings.update({ where: { id: s.id }, data: { callWaiterEnabled: false, requestBillEnabled: false, guestOrderingEnabled: false } });
    await prisma.menuSettings.update({ where: { id: s.id }, data: { showSoldOut: true, showPrices: true, menuEnabled: true } });

    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "PM check" }, select: { id: true } })).id;
    const mains = (await prisma.menuGroup.create({ data: { name: "PM Mains", department: "FOOD", rank: -5 }, select: { id: true } })).id;
    const drinks = (await prisma.menuGroup.create({ data: { name: "PM Drinks", department: "BAR", rank: -5 }, select: { id: true } })).id;
    const make = async (name: string, data: { price: string; menuGroupId?: string; productType?: "MENU_ITEM" | "INGREDIENT"; isAvailable?: boolean; showOnMenu?: boolean; stock: number; extra?: object }) => {
      const p = await prisma.product.create({
        data: {
          name,
          code: `PM-${name}-${Date.now()}`,
          price: data.price,
          cost: "123.45",
          orderTax: "0",
          categoryId,
          brandId,
          unitId,
          taxType: "EXCLUSIVE",
          productType: data.productType ?? "MENU_ITEM",
          menuGroupId: data.menuGroupId ?? null,
          isAvailable: data.isAvailable ?? true,
          showOnMenu: data.showOnMenu ?? true,
          menuDescription: `${name} described`,
          ...data.extra,
        },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: data.stock } });
      return p.id;
    };
    id.ok = await make("PM Jollof", { price: "1500", menuGroupId: mains, stock: 5, extra: { isSignature: true, allergens: ["Celery"], calories: 640 } });
    id.off = await make("PM Tilapia", { price: "2600.50", menuGroupId: mains, stock: 5, isAvailable: false });
    id.out = await make("PM Suya", { price: "1800", menuGroupId: mains, stock: 0 });
    id.flour = await make("PM Flour", { price: "1", productType: "INGREDIENT", showOnMenu: false, stock: 0 });
    id.recipeOut = await make("PM Puff-puff", { price: "700", menuGroupId: mains, stock: 99 });
    await prisma.recipeLine.create({ data: { menuItemId: id.recipeOut, ingredientId: id.flour, quantity: 1 } });
    id.hidden = await make("PM Staff meal", { price: "500", menuGroupId: mains, stock: 5, showOnMenu: false });
    id.deleted = await make("PM Old dish", { price: "900", menuGroupId: mains, stock: 5 });
    await prisma.product.update({ where: { id: id.deleted }, data: { deletedAt: new Date() } });
    id.drink = await make("PM Chapman", { price: "950", menuGroupId: drinks, stock: 5, extra: { photoPath: `menu/x/photo-1200.webp` } });
    await prisma.product.update({ where: { id: id.drink }, data: { photoPath: `menu/${id.drink}/photo-1200.webp` } });
    mediaDir = path.join(process.cwd(), "uploads", "menu", id.drink);
    await mkdir(mediaDir, { recursive: true });
    await writeFile(path.join(mediaDir, "photo-400.webp"), Buffer.from("RIFF0000WEBPVP8 test"));
  });
  after(async () => {
    await prisma.menuSettings.updateMany({ data: settingsBefore });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: moduleWas } });
    if (mediaDir) {
      await rm(mediaDir, { recursive: true, force: true });
      // uploads/menu itself too, if this test was all that was in it.
      await rmdir(path.dirname(mediaDir)).catch(() => undefined);
    }
  });

  test("a table's code opens its menu: Table <name> · its area, on Food", async () => {
    const page = asMenu(await menu());
    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId }, select: { name: true } });
    assert.deepEqual(page.where, { title: `Table ${table.name}`, area: "Public menu check", startDepartment: "FOOD" });
    assert.ok(page.departments.includes("FOOD") && page.departments.includes("BAR"));
  });

  test("each item's state by the POS's rule; hidden and deleted ones never there", async () => {
    const page = asMenu(await menu());
    const state = Object.fromEntries(mine(page).map((i) => [i.id, i.status]));
    assert.deepEqual(state, { [id.ok]: "available", [id.off]: "unavailable", [id.out]: "sold_out", [id.recipeOut]: "sold_out", [id.drink]: "available" });
    assert.equal(id.hidden in state || id.deleted in state || id.flour in state, false);
  });

  test("sections from the menu groups; the drink on Bar; the pills", async () => {
    const page = asMenu(await menu());
    const sectionName = (itemId: string) => page.sections.find((s) => s.id === page.items.find((i) => i.id === itemId)?.sectionId)?.name;
    assert.deepEqual([sectionName(id.ok), sectionName(id.drink)], ["PM Mains", "PM Drinks"]);
    const ok = page.items.find((i) => i.id === id.ok)!;
    const drink = page.items.find((i) => i.id === id.drink)!;
    assert.deepEqual([ok.department, drink.department], ["FOOD", "BAR"]);
    assert.deepEqual([ok.signature, ok.allergens, ok.calories, ok.description], [true, ["Celery"], 640, "PM Jollof described"]);
    assert.deepEqual(drink.photo, { full: `/menu/media/${id.drink}/photo-1200.webp`, thumb: `/menu/media/${id.drink}/photo-400.webp` });
  });

  test("prices exactly as the POS's order screen shows them; the header's notes", async () => {
    const page = asMenu(await menu());
    const pos = await getMenu(warehouseId);
    for (const itemId of [id.ok, id.off, id.drink]) {
      assert.equal(page.items.find((i) => i.id === itemId)!.price, pos.menu.items.find((c) => c.id === itemId)!.price, itemId);
    }
    assert.equal(page.items.find((i) => i.id === id.off)!.price, "₦2,600.50");
    const service = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantServiceChargePercent: true } })).restaurantServiceChargePercent;
    const expected = ["Prices include tax", ...(Number(service) > 0 ? [`${Number(service)}% service charge added to the bill`] : [])];
    assert.deepEqual(page.header.notes, expected);
    const takeaway = asMenu(await menu(takeawayToken));
    assert.deepEqual(takeaway.header.notes, ["Prices include tax"], "a takeaway point: no service charge");
  });

  test("nothing back-office in what the page gets", async () => {
    const page = asMenu(await menu());
    const keys = keysOf(page);
    for (const forbidden of ["cost", "unitCost", "stock", "quantity", "recipe", "recipeLines", "warehouse", "warehouseId", "qrToken", "waiter", "waiterId", "user", "userId", "email", "order", "orders", "isAvailable", "showOnMenu", "password", "training"]) {
      assert.equal(keys.has(forbidden), false, forbidden);
    }
    const json = JSON.stringify(page);
    assert.ok(!json.includes("123.45"), "no cost value");
    assert.ok(!json.includes(warehouseId), "no warehouse");
    const others = await prisma.table.findMany({ where: { id: { not: tableId } }, select: { qrToken: true }, take: 50 });
    assert.ok(others.every((t) => !json.includes(t.qrToken)), "no other table's code");
    assert.ok(!json.includes(token), "not even its own code");
  });

  test("the live check: each listed item's state, nothing else", async () => {
    const statuses = (await loadMenuStatuses(token))!;
    assert.deepEqual([statuses[id.ok], statuses[id.off], statuses[id.out], statuses[id.recipeOut], statuses[id.hidden], statuses[id.deleted]], ["available", "unavailable", "sold_out", "sold_out", undefined, undefined]);
    assert.ok(Object.values(statuses).every((s) => ["available", "sold_out", "unavailable"].includes(s)));
    const response = await statusRoute(new Request("http://localhost/x"), { params: Promise.resolve({ qrToken: token }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    // Plus the table's Call waiter / Request bill states (Step 6: null while
    // they're switched off, as on a fresh copy).
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["order", "requests", "statuses"]);
    assert.equal(body.requests, null);
    assert.equal(body.order, null);
    // Stock comes back: the live check says so.
    await prisma.productStock.updateMany({ where: { productId: id.out, warehouseId }, data: { quantity: 3 } });
    assert.equal((await loadMenuStatuses(token))![id.out], "available");
    await prisma.productStock.updateMany({ where: { productId: id.out, warehouseId }, data: { quantity: 0 } });
  });

  test("the settings: sold out hidden; prices hidden; the menu switched off", async () => {
    await prisma.menuSettings.updateMany({ data: { showSoldOut: false } });
    let page = asMenu(await menu());
    assert.deepEqual(mine(page).map((i) => i.id).sort(), [id.ok, id.off, id.drink].sort(), "sold out hidden; unavailable still shown");
    assert.equal((await loadMenuStatuses(token))![id.out], undefined);
    await prisma.menuSettings.updateMany({ data: { showSoldOut: true, showPrices: false } });
    page = asMenu(await menu());
    assert.ok(page.items.every((i) => i.price === null) && page.header.notes.length === 0);
    await prisma.menuSettings.updateMany({ data: { showPrices: true, menuEnabled: false } });
    const closed = await menu();
    assert.equal(closed.kind, "closed");
    assert.equal(await loadMenuStatuses(token), null);
    await prisma.menuSettings.updateMany({ data: { menuEnabled: true } });
  });

  test("a Bar point opens on Bar; a removed point, a rotated or deleted table, a deleted area, a made-up code: no longer active", async () => {
    assert.equal(asMenu(await menu(barToken)).where.startDepartment, "BAR");
    assert.equal(asMenu(await menu(barToken)).where.title, "PM bar");
    await prisma.qrPoint.updateMany({ where: { qrToken: barToken }, data: { deletedAt: new Date() } });
    assert.deepEqual(await menu(barToken), { kind: "inactive" });
    for (const t of ["", "short", "x".repeat(24), "../../../etc/passwd", newQrToken()]) assert.deepEqual(await menu(t), { kind: "inactive" }, t);
    assert.ok(await replaceQrToken(tableId));
    assert.deepEqual(await menu(token), { kind: "inactive" }, "the old printed code");
    const fresh = (await prisma.table.findUniqueOrThrow({ where: { id: tableId }, select: { qrToken: true } })).qrToken;
    assert.equal((await menu(fresh)).kind, "menu");
    token = fresh;
    await prisma.diningArea.update({ where: { id: areaId }, data: { deletedAt: new Date() } });
    assert.deepEqual(await menu(fresh), { kind: "inactive" }, "its area deleted");
    await prisma.diningArea.update({ where: { id: areaId }, data: { deletedAt: null } });
    await prisma.table.update({ where: { id: tableId }, data: { deletedAt: new Date() } });
    assert.deepEqual(await menu(fresh), { kind: "inactive" }, "the table deleted");
    await prisma.table.update({ where: { id: tableId }, data: { deletedAt: null } });
  });

  test("its pictures: a listed item's file only", async () => {
    const get = (parts: string[]) => mediaRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: parts }) });
    const ok = await get([id.drink, "photo-400.webp"]);
    assert.deepEqual([ok.status, ok.headers.get("content-type")], [200, "image/webp"]);
    assert.equal((await get([id.drink, "photo-1200.webp"])).status, 404, "a file that isn't there");
    assert.equal((await get([id.drink, "photo.svg"])).status, 404, "not a menu image type");
    assert.equal((await get([id.drink, "..", ".env"])).status, 404);
    assert.equal((await get([id.hidden, "photo-400.webp"])).status, 404, "an item not on the menu");
    assert.equal((await get(["logo"])).status, 404, "no logo set");
  });
});

describe("Module off: the guest menu doesn't exist (database copy)", { skip }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("the page is a 404; the live check and the pictures too", async () => {
    assert.deepEqual(await loadPublicMenu(token), { kind: "off" });
    assert.equal(await loadMenuStatuses(token), null);
    assert.equal((await statusRoute(new Request("http://localhost/x"), { params: Promise.resolve({ qrToken: token }) })).status, 404);
    assert.equal((await mediaRoute(new Request("http://localhost/x"), { params: Promise.resolve({ path: [id.drink || "x", "photo-400.webp"] }) })).status, 404);
  });
});
