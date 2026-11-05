// Food › Menu items against a real database (services/menuItems.ts and
// queries/menuItems.ts). Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/food.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { menuItemSchema, type MenuItemInput } from "../schemas/menuItem";
import { createMenuItem, deleteMenuItem, GROUP_NOT_FOUND, IN_A_RECIPE, MENU_ITEM_GONE, ON_OPEN_ORDER, setItemModifierGroup, setMenuItemFlag, updateMenuItem } from "../server/services/menuItems";
import { getMenuItemList } from "../server/queries/menuItems";
import { modifierGroupSchema } from "../schemas/modifierGroup";
import { createModifierGroup, deleteModifierGroup, GROUP_GONE, updateModifierGroup } from "../server/services/modifierGroups";
import { getModifierGroupList } from "../server/queries/modifierGroups";
import { modifierSchema } from "../schemas/modifier";
import { createModifier, deleteModifier, MODIFIER_GONE, moveModifier, updateModifier } from "../server/services/modifiers";
import { getModifiersInGroup } from "../server/queries/modifierList";
import { getModifierGroupsFor } from "../server/queries/modifiers";
import { recipeLineSchema } from "../schemas/recipe";
import { addRecipeLine, deleteRecipeLine, RECIPE_LINE_GONE } from "../server/services/recipes";
import { getRecipe } from "../server/queries/recipes";
import { dishesInStock, recipeSelect } from "../server/menuStock";
import { getOrderScreen } from "../server/queries/orderScreen";
import { addLine } from "../server/services/orderLines";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let categoryId = "";
let otherCategoryId = "";
let warehouseId = "";
let kit = "";
const input = (over: Partial<Record<keyof MenuItemInput, string>> = {}): MenuItemInput =>
  menuItemSchema.parse({ code: "FD-001", name: "FD Jollof", categoryId, price: "18.00", description: "", stationId: "", ...over });
const byCode = (code: string) => prisma.product.findUniqueOrThrow({ where: { code } });
const list = (q = "FD", category?: string) => getMenuItemList({ q, categoryId: category, page: 1, perPage: 50 });

describe("Food › Menu items (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    categoryId = (await prisma.category.create({ data: { name: "FD Mains" } })).id;
    otherCategoryId = (await prisma.category.create({ data: { name: "FD Drinks" } })).id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null } })).id;
    kit = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("create: a MENU_ITEM with the given fields; brand Restaurant and unit pc (made once); Available, not yet On menu", async () => {
    assert.deepEqual(await createMenuItem(input({ stationId: kit, description: "Smoky party jollof" })), { ok: true });
    assert.deepEqual(await createMenuItem(input({ code: "FD-002", name: "FD Chapman", categoryId: otherCategoryId, price: "6" })), { ok: true });
    const item = await prisma.product.findUniqueOrThrow({ where: { code: "FD-001" }, include: { brand: true, unit: true } });
    assert.deepEqual(
      [item.productType, item.name, item.price.toFixed(2), item.menuDescription, item.stationId, item.taxType, item.isAvailable, item.showOnMenu, item.brand.name, item.unit.name],
      ["MENU_ITEM", "FD Jollof", "18.00", "Smoky party jollof", kit, "EXCLUSIVE", true, false, "Restaurant", "pc"],
    );
    assert.equal(await prisma.brand.count({ where: { name: "Restaurant", deletedAt: null } }), 1, "the default brand is made once");
    assert.equal(await prisma.productStock.count({ where: { productId: item.id } }), 0, "no stock rows");
  });

  test("codes are unique across every product (a retail product's code too); a missing category is a field error", async () => {
    assert.deepEqual(await createMenuItem(input({ name: "Again" })), { ok: false, error: "Please fix the errors below.", fieldErrors: { code: ["Another product already uses this code."] } });
    const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { code: true } });
    if (retail) {
      assert.deepEqual((await createMenuItem(input({ code: retail.code }))).ok, false);
    }
    assert.deepEqual(await createMenuItem(input({ code: "FD-003", categoryId: "no-such-category" })), { ok: false, error: "Please fix the errors below.", fieldErrors: { categoryId: ["Choose a category."] } });
  });

  test("edit: fields saved; a code taken by another product is refused; a retail product can't be edited here", async () => {
    const item = await byCode("FD-001");
    assert.deepEqual(await updateMenuItem(item.id, input({ name: "FD Jollof Rice", price: "19.50", stationId: "" })), { ok: true });
    const saved = await byCode("FD-001");
    assert.deepEqual([saved.name, saved.price.toFixed(2), saved.stationId], ["FD Jollof Rice", "19.50", null]);
    assert.equal((await updateMenuItem(item.id, input({ code: "FD-002" }))).ok, false);
    const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { id: true } });
    if (retail) assert.deepEqual(await updateMenuItem(retail.id, input({ code: "FD-009" })), { ok: false, error: MENU_ITEM_GONE });
  });

  test("Available / On menu switches save; only on menu items; no stock touched", async () => {
    const item = await byCode("FD-001");
    assert.deepEqual(await setMenuItemFlag(item.id, "showOnMenu", true), { ok: true });
    assert.deepEqual(await setMenuItemFlag(item.id, "isAvailable", false), { ok: true });
    const saved = await byCode("FD-001");
    assert.deepEqual([saved.showOnMenu, saved.isAvailable], [true, false]);
    const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { id: true } });
    if (retail) assert.deepEqual(await setMenuItemFlag(retail.id, "isAvailable", false), { ok: false, error: MENU_ITEM_GONE });
  });

  test("the list: menu items only (no retail, ingredients or deleted), search, category filter, recipe food cost and margin", async () => {
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { name: "pc" } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { name: "Restaurant" } })).id;
    const rice = await prisma.product.create({ data: { name: "FD Rice", code: "FD-IN-1", price: "0", cost: "2.20", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "INGREDIENT" } });
    const chicken = await prisma.product.create({ data: { name: "FD Chicken", code: "FD-IN-2", price: "0", cost: "6.00", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "INGREDIENT" } });
    const jollof = await byCode("FD-001");
    await prisma.recipeLine.createMany({ data: [{ menuItemId: jollof.id, ingredientId: rice.id, quantity: "0.25" }, { menuItemId: jollof.id, ingredientId: chicken.id, quantity: "0.3" }] });

    const all = await list();
    assert.deepEqual(all.rows.map((r) => r.code).sort(), ["FD-001", "FD-002"], "ingredients don't appear");
    const row = all.rows.find((r) => r.code === "FD-001")!;
    assert.deepEqual(
      [row.category, row.price, row.recipe.map((l) => [l.name, l.quantity, l.cost]), row.foodCost, row.margin],
      ["FD Mains", "19.50", [["FD Rice", "0.25", "0.55"], ["FD Chicken", "0.3", "1.80"]], "2.35", 88],
    );
    assert.equal(all.rows.find((r) => r.code === "FD-002")!.foodCost, null, "no recipe → own stock");
    assert.deepEqual((await list("FD Chapman")).rows.map((r) => r.code), ["FD-002"]);
    assert.deepEqual((await list("FD", otherCategoryId)).rows.map((r) => r.code), ["FD-002"]);
    const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { code: true } });
    if (retail) assert.equal((await list(retail.code)).rows.length, 0, "retail products never appear");
  });

  test("delete: refused on an open order and while used in a recipe; otherwise soft-deleted with its recipe lines", async () => {
    const chapman = await byCode("FD-002");
    const order = await prisma.order.create({ data: { type: "TAKEAWAY", status: "OPEN", warehouseId, items: { create: { productId: chapman.id, quantity: 1, unitPrice: "6" } } } });
    assert.deepEqual(await deleteMenuItem(chapman.id), { ok: false, error: ON_OPEN_ORDER });
    assert.equal((await list()).rows.find((r) => r.code === "FD-002")?.deleteBlocker, ON_OPEN_ORDER);
    await prisma.order.update({ where: { id: order.id }, data: { status: "BILLED" } });
    assert.equal((await list()).rows.find((r) => r.code === "FD-002")?.deleteBlocker, null, "billed history doesn't block");

    // A menu item used as an ingredient (e.g. a side in a combo).
    const jollof = await byCode("FD-001");
    await prisma.recipeLine.create({ data: { menuItemId: jollof.id, ingredientId: chapman.id, quantity: "1" } });
    assert.deepEqual(await deleteMenuItem(chapman.id), { ok: false, error: IN_A_RECIPE });
    await prisma.recipeLine.deleteMany({ where: { ingredientId: chapman.id } });

    assert.deepEqual(await deleteMenuItem(chapman.id), { ok: true });
    assert.ok((await byCode("FD-002")).deletedAt);
    assert.deepEqual(await deleteMenuItem(chapman.id), { ok: false, error: MENU_ITEM_GONE });
    assert.deepEqual((await list()).rows.map((r) => r.code), ["FD-001"], "deleted items leave the list");

    assert.deepEqual(await deleteMenuItem(jollof.id), { ok: true });
    assert.equal(await prisma.recipeLine.count({ where: { menuItemId: jollof.id, deletedAt: null } }), 0, "its recipe lines are soft-deleted too");
  });

  test("two edits to the same item at once both finish cleanly (row lock); the last one wins", async () => {
    await createMenuItem(input({ code: "FD-010", name: "FD Race" }));
    const item = await byCode("FD-010");
    const results = await Promise.all([updateMenuItem(item.id, input({ code: "FD-010", name: "FD Race A" })), updateMenuItem(item.id, input({ code: "FD-010", name: "FD Race B" }))]);
    assert.deepEqual(results, [{ ok: true }, { ok: true }]);
    assert.ok(["FD Race A", "FD Race B"].includes((await byCode("FD-010")).name));
    const both = await Promise.all([createMenuItem(input({ code: "FD-011", name: "One" })), createMenuItem(input({ code: "FD-011", name: "Two" }))]);
    assert.equal(both.filter((r) => r.ok).length, 1, "two creates with the same code: one wins, the other gets the field error");
  });

  describe("modifier groups", () => {
    const groupInput = (name: string, minSelect: number, maxSelect: number) => modifierGroupSchema.parse({ name, minSelect, maxSelect, required: minSelect >= 1 });
    const groupByName = (name: string) => prisma.modifierGroup.findFirstOrThrow({ where: { name, deletedAt: null } });
    const groupList = (q = "MG", filter: "required" | "optional" | null = null) => getModifierGroupList({ q, filter, page: 1, perPage: 50 });

    test("create: in order, no modifiers made; names unique among live groups (any case)", async () => {
      assert.deepEqual(await createModifierGroup(groupInput("MG Portion", 1, 1)), { ok: true });
      assert.deepEqual(await createModifierGroup(groupInput("MG Extras", 0, 2)), { ok: true });
      const [portion, extras] = [await groupByName("MG Portion"), await groupByName("MG Extras")];
      assert.ok(extras.sortOrder > portion.sortOrder, "new groups go last");
      assert.equal(await prisma.modifier.count({ where: { groupId: portion.id } }), 0);
      assert.deepEqual(await createModifierGroup(groupInput("mg portion", 0, 1)), { ok: false, error: "Please fix the errors below.", fieldErrors: { name: ["Another modifier group already has this name."] } });
    });

    test("edit: rules saved; renaming onto another group's name is refused", async () => {
      const extras = await groupByName("MG Extras");
      assert.deepEqual(await updateModifierGroup(extras.id, groupInput("MG Extras", 1, 3)), { ok: true });
      const saved = await groupByName("MG Extras");
      assert.deepEqual([saved.minSelect, saved.maxSelect], [1, 3]);
      assert.equal((await updateModifierGroup(extras.id, groupInput("MG Portion", 1, 3))).ok, false);
      assert.deepEqual(await updateModifierGroup(extras.id, groupInput("MG Extras", 0, 2)), { ok: true }, "keeping its own name is fine");
    });

    test("the list: type, rule, required, item and modifier counts; search and Required / Optional", async () => {
      const portion = await groupByName("MG Portion");
      await prisma.modifier.createMany({ data: [{ groupId: portion.id, name: "Regular" }, { groupId: portion.id, name: "Large", price: "2" }] });
      const item = await byCode("FD-010");
      await prisma.product.update({ where: { id: item.id }, data: { modifierGroups: { connect: { id: portion.id } } } });
      const { rows } = await groupList();
      const row = rows.find((r) => r.name === "MG Portion")!;
      assert.deepEqual([row.type, row.rule, row.required, row.items, row.modifiers, row.deleteBlocker], ["Single choice", "required", true, 1, 2, "It's on 1 menu item. Take it off them first."]);
      assert.deepEqual(rows.find((r) => r.name === "MG Extras")?.rule, "up to 2");
      assert.deepEqual((await groupList("MG", "required")).rows.map((r) => r.name), ["MG Portion"]);
      assert.deepEqual((await groupList("MG", "optional")).rows.map((r) => r.name), ["MG Extras"]);
      assert.deepEqual((await groupList("mg extras")).rows.map((r) => r.name), ["MG Extras"], "search, any case");
    });

    test("delete: refused while a live menu item uses it; a deleted item doesn't count; then soft-deleted with its modifiers", async () => {
      const portion = await groupByName("MG Portion");
      assert.deepEqual(await deleteModifierGroup(portion.id), { ok: false, error: "It's on 1 menu item. Take it off them first." });
      await prisma.product.update({ where: { code: "FD-010" }, data: { deletedAt: new Date() } });
      assert.deepEqual(await deleteModifierGroup(portion.id), { ok: true });
      const gone = await prisma.modifierGroup.findUniqueOrThrow({ where: { id: portion.id }, include: { modifiers: true } });
      assert.ok(gone.deletedAt && gone.modifiers.every((m) => m.deletedAt));
      assert.deepEqual(await deleteModifierGroup(portion.id), { ok: false, error: GROUP_GONE });
      assert.deepEqual(await createModifierGroup(groupInput("MG Portion", 1, 1)), { ok: true }, "a deleted group's name can be used again");
    });

    test("two edits to the same group at once both finish cleanly (row lock); two creates of one new name: one wins, no errors thrown", async () => {
      for (const round of [1, 2, 3]) {
        const g = await groupByName("MG Extras");
        const results = await Promise.all([updateModifierGroup(g.id, groupInput("MG Extras", 0, 2)), updateModifierGroup(g.id, groupInput("MG Extras", 0, 3))]);
        assert.deepEqual(results, [{ ok: true }, { ok: true }], `round ${round}`);
        const both = await Promise.all([createModifierGroup(groupInput(`MG New ${round}`, 0, 1)), createModifierGroup(groupInput(`MG New ${round}`, 0, 1))]);
        assert.equal(both.filter((r) => r.ok).length, 1, `round ${round}: ${JSON.stringify(both)}`);
        assert.equal(await prisma.modifierGroup.count({ where: { name: `MG New ${round}`, deletedAt: null } }), 1);
      }
    });
  });

  describe("modifiers in a group", () => {
    let sizeId = "";
    let sauceId = "";
    const mod = (groupId: string, name: string, price = "0") => modifierSchema.parse({ groupId, name, price });
    const inGroup = async (groupId: string) => (await getModifiersInGroup(groupId)).map((m) => [m.rank, m.name, m.price]);
    const modByName = (groupId: string, name: string) => prisma.modifier.findFirstOrThrow({ where: { groupId, name, deletedAt: null } });

    before(async () => {
      sizeId = (await prisma.modifierGroup.create({ data: { name: "MD Size", minSelect: 1, maxSelect: 1 } })).id;
      sauceId = (await prisma.modifierGroup.create({ data: { name: "MD Sauce", minSelect: 0, maxSelect: 2 } })).id;
    });

    test("create: ranked in the order added; prices may be negative; names unique within a group (any case), not across groups", async () => {
      assert.deepEqual(await createModifier(mod(sizeId, "Regular")), { ok: true });
      assert.deepEqual(await createModifier(mod(sizeId, "Large", "2")), { ok: true });
      assert.deepEqual(await createModifier(mod(sizeId, "Kids", "-1.50")), { ok: true });
      assert.deepEqual(await inGroup(sizeId), [[1, "Regular", "0.00"], [2, "Large", "2.00"], [3, "Kids", "-1.50"]]);
      assert.deepEqual(await createModifier(mod(sizeId, "large")), { ok: false, error: "Please fix the errors below.", fieldErrors: { name: ["This group already has a modifier with this name."] } });
      assert.deepEqual(await createModifier(mod(sauceId, "Large")), { ok: true }, "the same name in another group is fine");
      assert.deepEqual((await createModifier(mod("no-such-group", "X"))).ok, false);
    });

    test("edit: name and price; moving to another group puts it last there; a clash in the target group is refused", async () => {
      const kids = await modByName(sizeId, "Kids");
      assert.deepEqual(await updateModifier(kids.id, mod(sizeId, "Kids", "-2")), { ok: true });
      assert.equal((await modByName(sizeId, "Kids")).price.toFixed(2), "-2.00");
      const regular = await modByName(sizeId, "Regular");
      assert.deepEqual(await updateModifier(regular.id, mod(sauceId, "Large")), { ok: false, error: "Please fix the errors below.", fieldErrors: { name: ["This group already has a modifier with this name."] } });
      assert.deepEqual(await updateModifier(regular.id, mod(sauceId, "Regular")), { ok: true });
      assert.deepEqual(await inGroup(sauceId), [[1, "Large", "0.00"], [2, "Regular", "0.00"]]);
      assert.deepEqual(await updateModifier(regular.id, mod(sizeId, "Regular")), { ok: true }, "and back");
    });

    test("↑ / ↓ re-rank and renumber; the ends stay put", async () => {
      const regular = await modByName(sizeId, "Regular");
      assert.deepEqual(await inGroup(sizeId), [[1, "Large", "2.00"], [2, "Kids", "-2.00"], [3, "Regular", "0.00"]]);
      assert.deepEqual(await moveModifier(regular.id, "up"), { ok: true });
      assert.deepEqual(await moveModifier(regular.id, "up"), { ok: true });
      assert.deepEqual(await moveModifier(regular.id, "up"), { ok: true }, "already first");
      assert.deepEqual(await inGroup(sizeId), [[1, "Regular", "0.00"], [2, "Large", "2.00"], [3, "Kids", "-2.00"]]);
      const ranks = (await prisma.modifier.findMany({ where: { groupId: sizeId, deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true } })).map((m) => m.sortOrder);
      assert.deepEqual(ranks, [0, 1, 2]);
    });

    test("the order screen lists them in rank order; a deleted one disappears from it", async () => {
      const item = await prisma.product.create({ data: { name: "MD Dish", code: `MD-${Date.now()}`, price: "10", categoryId, brandId: (await prisma.brand.findFirstOrThrow()).id, unitId: (await prisma.unit.findFirstOrThrow()).id, taxType: "EXCLUSIVE", productType: "MENU_ITEM", modifierGroups: { connect: [{ id: sizeId }] } } });
      const options = async () => (await getModifierGroupsFor([item.id]))[item.id][0].options.map((o) => [o.name, o.price]);
      const shown = await options();
      assert.deepEqual(shown.map((o) => o[0]), ["Regular", "Large", "Kids"], "rank order");
      assert.deepEqual(shown.slice(0, 2), [["Regular", ""], ["Large", "+₦2.00"]]);
      const kids = await modByName(sizeId, "Kids");
      assert.deepEqual(await deleteModifier(kids.id), { ok: true });
      assert.deepEqual((await options()).map((o) => o[0]), ["Regular", "Large"]);
      assert.deepEqual(await deleteModifier(kids.id), { ok: false, error: MODIFIER_GONE });
    });

    test("delete: refused while a line on an open order has it in its options snapshot; fine once billed", async () => {
      const large = await modByName(sizeId, "Large");
      const product = await prisma.product.findFirstOrThrow({ where: { name: "MD Dish" } });
      const order = await prisma.order.create({
        data: { type: "TAKEAWAY", status: "SENT", warehouseId, items: { create: { productId: product.id, quantity: 1, unitPrice: "12", modifiers: [{ id: large.id, group: "MD Size", name: "Large", price: "2.00" }] } } },
      });
      assert.deepEqual(await deleteModifier(large.id), { ok: false, error: "It's chosen on 1 line of an open order. Delete it once those orders are closed." });
      assert.equal((await getModifiersInGroup(sizeId)).find((m) => m.name === "Large")?.deleteBlocker, "It's chosen on 1 line of an open order. Delete it once those orders are closed.");
      await prisma.order.update({ where: { id: order.id }, data: { status: "BILLED" } });
      assert.deepEqual(await deleteModifier(large.id), { ok: true });
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      assert.deepEqual(line.modifiers, [{ id: large.id, group: "MD Size", name: "Large", price: "2.00" }], "the billed line keeps its snapshot");
    });

    test("at the same time: two adds of one name in a group (one wins); two moves in a group (both finish, ranks stay 0..n-1)", async () => {
      for (const round of [1, 2, 3]) {
        const both = await Promise.all([createModifier(mod(sauceId, `Hot ${round}`)), createModifier(mod(sauceId, `Hot ${round}`))]);
        assert.equal(both.filter((r) => r.ok).length, 1, `round ${round}`);
        const [first, second] = await prisma.modifier.findMany({ where: { groupId: sauceId, deletedAt: null }, orderBy: { sortOrder: "asc" }, take: 2 });
        const moves = await Promise.all([moveModifier(second.id, "up"), moveModifier(first.id, "down")]);
        assert.deepEqual(moves, [{ ok: true }, { ok: true }]);
        const ranks = (await prisma.modifier.findMany({ where: { groupId: sauceId, deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true } })).map((m) => m.sortOrder);
        assert.deepEqual(ranks, ranks.map((_, i) => i), `round ${round}: ranks ${ranks}`);
      }
    });
  });

  describe("modifier groups on menu items", () => {
    let dishId = "";
    let spiceId = "";
    let sidesId = "";
    let emptyId = "";
    before(async () => {
      await createMenuItem(input({ code: "AT-001", name: "AT Suya" }));
      dishId = (await byCode("AT-001")).id;
      spiceId = (await prisma.modifierGroup.create({ data: { name: "AT Spice", minSelect: 1, maxSelect: 1, modifiers: { create: [{ name: "Mild" }, { name: "Hot", sortOrder: 1 }] } } })).id;
      sidesId = (await prisma.modifierGroup.create({ data: { name: "AT Sides", minSelect: 1, maxSelect: 2, modifiers: { create: [{ name: "Plantain", price: "1" }] } } })).id;
      emptyId = (await prisma.modifierGroup.create({ data: { name: "AT Empty", minSelect: 0, maxSelect: 1 } })).id;
    });
    const attachedNames = async () => ((await list("AT Suya")).rows[0]?.groups ?? []).filter((g) => g.startsWith("AT "));

    test("switch a group on and off; doing it twice is fine; the list and the order screen follow", async () => {
      assert.deepEqual(await setItemModifierGroup(dishId, spiceId, true), { ok: true });
      assert.deepEqual(await setItemModifierGroup(dishId, spiceId, true), { ok: true }, "already on");
      assert.deepEqual(await setItemModifierGroup(dishId, sidesId, true), { ok: true });
      assert.deepEqual(await setItemModifierGroup(dishId, emptyId, true), { ok: true });
      assert.deepEqual((await attachedNames()).sort(), ["AT Empty", "AT Sides", "AT Spice"]);
      const row = (await list("AT Suya")).rows[0];
      assert.deepEqual(new Set(row.groupIds), new Set([spiceId, sidesId, emptyId]));
      const onScreen = (await getModifierGroupsFor([dishId]))[dishId].map((g) => [g.name, g.rule, g.options.length]);
      assert.deepEqual(onScreen.filter((g) => String(g[0]).startsWith("AT ")), [["AT Sides", "pick 1–2", 1], ["AT Spice", "required", 2]], "in group order (same rank → by name); the empty group isn't offered");
      assert.deepEqual(await setItemModifierGroup(dishId, sidesId, false), { ok: true });
      assert.deepEqual(await setItemModifierGroup(dishId, sidesId, false), { ok: true }, "already off");
      assert.ok(!(await list("AT Suya")).rows[0].groupIds.includes(sidesId));
    });

    test("a deleted group can't be switched on; a retail product or deleted item can't be changed", async () => {
      const gone = await prisma.modifierGroup.create({ data: { name: "AT Gone", deletedAt: new Date() } });
      assert.deepEqual(await setItemModifierGroup(dishId, gone.id, true), { ok: false, error: GROUP_NOT_FOUND });
      const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { id: true } });
      if (retail) assert.deepEqual(await setItemModifierGroup(retail.id, spiceId, true), { ok: false, error: MENU_ITEM_GONE });
    });

    test("several switches on one item at once all land (the item row is locked)", async () => {
      for (const round of [1, 2, 3]) {
        const results = await Promise.all([setItemModifierGroup(dishId, sidesId, true), setItemModifierGroup(dishId, emptyId, false), setItemModifierGroup(dishId, spiceId, true)]);
        assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }], `round ${round}`);
        assert.deepEqual(new Set((await list("AT Suya")).rows[0].groupIds), new Set([spiceId, sidesId]));
        await setItemModifierGroup(dishId, emptyId, true);
      }
    });
  });

  describe("recipes", () => {
    let dishId = "";
    let riceId = "";
    const line = (over: Partial<Record<"ingredientId" | "name" | "unit" | "cost" | "quantity", string>>) =>
      recipeLineSchema.parse({ menuItemId: dishId, ingredientId: "", name: "", unit: "", cost: "", quantity: "1", ...over });
    before(async () => {
      await createMenuItem(input({ code: "RC-001", name: "RC Jollof", price: "18.00" }));
      dishId = (await byCode("RC-001")).id;
      const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null } })).id;
      const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null } })).id;
      // Recipes take whole units, so ingredients are kept in small ones: rice in grams, ₦0.01 a gram.
      riceId = (await prisma.product.create({ data: { name: "RC Rice", code: `RC-IN-${Date.now()}`, price: "0", cost: "0.01", categoryId, brandId, unitId: (await prisma.unit.create({ data: { name: "RCg" } })).id, taxType: "EXCLUSIVE", productType: "INGREDIENT" } })).id;
      void unitId;
    });

    test("an existing ingredient: the line costs qty × its cost; food cost and margin follow", async () => {
      assert.deepEqual(await addRecipeLine(line({ ingredientId: riceId, quantity: "250" })), { ok: true });
      const recipe = (await getRecipe(dishId))!;
      assert.deepEqual(recipe.lines.map((l) => [l.ingredient, l.quantity, l.unit, l.unitCost, l.lineCost, l.partUnit]), [["RC Rice", "250", "RCg", "0.01", "2.50", false]]);
      assert.deepEqual([recipe.foodCost, recipe.margin], ["2.50", 86]);
    });

    test("a new ingredient is made on the spot: INGREDIENT, next IN- code, category Ingredients, its unit and cost, no stock rows", async () => {
      assert.deepEqual(await addRecipeLine(line({ name: "RC Chicken thighs", unit: "RCg", cost: "0.02", quantity: "300" })), { ok: true });
      const made = await prisma.product.findFirstOrThrow({ where: { name: "RC Chicken thighs" }, include: { category: true, unit: true } });
      assert.deepEqual([made.productType, /^IN-\d{3,}$/.test(made.code), made.category.name, made.unit.name, made.cost?.toFixed(2), made.price.toFixed(2)], ["INGREDIENT", true, "Ingredients", "RCg", "0.02", "0.00"]);
      assert.equal(await prisma.productStock.count({ where: { productId: made.id } }), 0);
      assert.deepEqual(await addRecipeLine(line({ name: "RC Plantain", unit: "RCpc", quantity: "1" })), { ok: true });
      const plantain = await prisma.product.findFirstOrThrow({ where: { name: "RC Plantain" }, include: { unit: true } });
      assert.equal(plantain.unit.name, "RCpc", "a new unit is made too");
      assert.equal(Number(plantain.code.slice(3)), Number(made.code.slice(3)) + 1, "codes count up");
      const recipe = (await getRecipe(dishId))!;
      assert.deepEqual(recipe.lines.map((l) => [l.ingredient, l.unitCost, l.lineCost]), [["RC Rice", "0.01", "2.50"], ["RC Chicken thighs", "0.02", "6.00"], ["RC Plantain", null, "0.00"]]);
      assert.deepEqual([recipe.foodCost, recipe.margin], ["8.50", 53]);
    });

    test("a typed name that matches an ingredient (any case) uses it; one line per ingredient; only INGREDIENT products", async () => {
      const before = await prisma.product.count({ where: { productType: "INGREDIENT" } });
      assert.deepEqual(await addRecipeLine(line({ name: "rc rice", unit: "kg", quantity: "1" })), { ok: false, error: "Please fix the errors below.", fieldErrors: { name: ["It's already in this recipe. Delete that line to change its quantity."] } });
      assert.equal(await prisma.product.count({ where: { productType: "INGREDIENT" } }), before, "no duplicate ingredient made");
      assert.deepEqual((await addRecipeLine(line({ ingredientId: dishId }))).ok, false, "a menu item isn't an ingredient here");
      const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { id: true } });
      if (retail) assert.deepEqual((await addRecipeLine(line({ ingredientId: retail.id }))).ok, false);
    });

    test("removing a line: food cost follows; the menu items list agrees; removing twice is told", async () => {
      const recipe = (await getRecipe(dishId))!;
      const chicken = recipe.lines.find((l) => l.ingredient === "RC Chicken thighs")!;
      assert.deepEqual(await deleteRecipeLine(chicken.id), { ok: true });
      const after = (await getRecipe(dishId))!;
      assert.deepEqual([after.lines.map((l) => l.ingredient), after.foodCost, after.margin], [["RC Rice", "RC Plantain"], "2.50", 86]);
      const row = (await list("RC Jollof")).rows[0];
      assert.deepEqual([row.foodCost, row.margin, row.recipe.length], ["2.50", 86, 2]);
      assert.deepEqual(await deleteRecipeLine(chicken.id), { ok: false, error: RECIPE_LINE_GONE });
      assert.ok(await prisma.product.findFirst({ where: { name: "RC Chicken thighs", deletedAt: null } }), "the ingredient itself stays");
    });

    test("at the same time: two new ingredients get different codes; the same ingredient twice → one line", async () => {
      const both = await Promise.all([addRecipeLine(line({ name: "RC Salt", unit: "RCg", quantity: "5" })), addRecipeLine(line({ name: "RC Pepper", unit: "RCg", quantity: "2" }))]);
      assert.deepEqual(both, [{ ok: true }, { ok: true }]);
      const codes = (await prisma.product.findMany({ where: { name: { in: ["RC Salt", "RC Pepper"] } }, select: { code: true } })).map((p) => p.code);
      assert.equal(new Set(codes).size, 2);
      const twice = await Promise.all([addRecipeLine(line({ name: "RC Garlic", unit: "RCg", quantity: "3" })), addRecipeLine(line({ name: "RC Garlic", unit: "RCg", quantity: "3" }))]);
      assert.equal(twice.filter((r) => r.ok).length, 1, JSON.stringify(twice));
      assert.equal(await prisma.product.count({ where: { name: "RC Garlic" } }), 1, "made once");
      assert.equal((await getRecipe(dishId))!.lines.filter((l) => l.ingredient === "RC Garlic").length, 1);
    });
  });

  describe("availability on the order screen", () => {
    test("in stock in the order's warehouse: own stock > 0; a recipe needs one serving of each ingredient", async () => {
      const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null } })).id;
      const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null } })).id;
      const make = (name: string, productType: "MENU_ITEM" | "INGREDIENT") =>
        prisma.product.create({ data: { name, code: `AV-${name}-${Date.now()}`, price: "5", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType }, select: { id: true } }).then((p) => p.id);
      const stock = (productId: string, quantity: number) => prisma.productStock.create({ data: { productId, warehouseId, quantity } });
      const water = await make("AV Water", "MENU_ITEM");
      const juice = await make("AV Juice", "MENU_ITEM");
      const rice = await make("AV Rice", "INGREDIENT");
      const salt = await make("AV Salt", "INGREDIENT");
      const jollof = await make("AV Jollof", "MENU_ITEM");
      const pilau = await make("AV Pilau", "MENU_ITEM");
      await stock(water, 5);
      await stock(juice, 0);
      await stock(rice, 1);
      await stock(salt, 0);
      await prisma.recipeLine.createMany({
        data: [
          { menuItemId: jollof, ingredientId: rice, quantity: "1" },
          { menuItemId: pilau, ingredientId: rice, quantity: "0.5" },
          { menuItemId: pilau, ingredientId: salt, quantity: "0.01" },
        ],
      });
      const dishes = await prisma.product.findMany({ where: { id: { in: [water, juice, jollof, pilau] } }, select: { id: true, recipeLines: recipeSelect } });
      const inStock = await dishesInStock(prisma, dishes, warehouseId);
      assert.deepEqual([water, juice, jollof, pilau].map((id) => inStock.has(id)), [true, false, true, false], "water 5, juice 0, jollof needs 1 rice (has 1), pilau needs salt (has 0)");
      const other = await prisma.warehouse.create({ data: { name: "AV other", email: "x@example.com", phoneNumber: "0", country: "NG", city: "Lagos", zipCode: "0" } });
      assert.equal((await dishesInStock(prisma, dishes, other.id)).size, 0, "another warehouse's stock doesn't count");
    });
  });

  describe("Food → order screen, end to end", () => {
    test("an item made in Food shows on the order screen with its options; deleted modifiers and items drop out", async () => {
      // Made the way the Food screens make them.
      assert.deepEqual(await createMenuItem(input({ code: "E2E-001", name: "E2E Suya", price: "18.00" })), { ok: true });
      const dish = await byCode("E2E-001");
      await prisma.productStock.create({ data: { productId: dish.id, warehouseId, quantity: 20 } });
      assert.deepEqual(await createModifierGroup(modifierGroupSchema.parse({ name: "E2E Spice", minSelect: 1, maxSelect: 1, required: true })), { ok: true });
      const spice = await prisma.modifierGroup.findFirstOrThrow({ where: { name: "E2E Spice", deletedAt: null } });
      for (const [name, price] of [["Mild", ""], ["Hot", "1.50"]]) assert.ok((await createModifier(modifierSchema.parse({ groupId: spice.id, name, price }))).ok);
      assert.deepEqual(await setItemModifierGroup(dish.id, spice.id, true), { ok: true });

      // On the order screen of an open order in the same warehouse.
      const order = await prisma.order.create({ data: { type: "TAKEAWAY", status: "OPEN", warehouseId }, select: { id: true, version: true } });
      const screen = (await getOrderScreen(order.id))!;
      const card = screen.menu.items.find((i) => i.id === dish.id)!;
      assert.deepEqual([card.name, card.price, card.hasOptions, card.unavailable], ["E2E Suya", "₦18.00", true, null]);
      assert.deepEqual(screen.modifierGroups[dish.id].map((g) => [g.name, g.rule, g.options.map((o) => [o.name, o.price])]), [["E2E Spice", "required", [["Mild", ""], ["Hot", "+₦1.50"]]]]);

      // Ordered with Hot: the line's price is the server's snapshot, 18 + 1.50.
      const hot = await prisma.modifier.findFirstOrThrow({ where: { groupId: spice.id, name: "Hot" } });
      assert.deepEqual((await addLine({ orderId: order.id, version: order.version, productId: dish.id, modifierIds: [hot.id], note: null })).ok, true);
      const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      assert.deepEqual([line.unitPrice.toFixed(2), line.modifiers], ["19.50", [{ id: hot.id, group: "E2E Spice", name: "Hot", price: "1.50" }]]);

      // Hot is on an open order's line, so it can't be deleted; Mild can — then it's no longer offered.
      assert.equal((await deleteModifier(hot.id)).ok, false);
      const mild = await prisma.modifier.findFirstOrThrow({ where: { groupId: spice.id, name: "Mild" } });
      assert.deepEqual(await deleteModifier(mild.id), { ok: true });
      const after = (await getOrderScreen(order.id))!;
      assert.deepEqual(after.modifierGroups[dish.id][0].options.map((o) => o.name), ["Hot"], "a deleted modifier isn't offered");
      const v = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).version;
      const refused = await addLine({ orderId: order.id, version: v, productId: dish.id, modifierIds: [mild.id], note: null });
      assert.equal(refused.ok, false, "and a screen still sending it is refused");

      // The item itself: blocked while on the open order; once the order is billed it can go, and leaves the menu.
      assert.deepEqual(await deleteMenuItem(dish.id), { ok: false, error: ON_OPEN_ORDER });
      await prisma.order.update({ where: { id: order.id }, data: { status: "BILLED" } });
      assert.deepEqual(await deleteMenuItem(dish.id), { ok: true });
      const other = await prisma.order.create({ data: { type: "TAKEAWAY", status: "OPEN", warehouseId }, select: { id: true } });
      assert.ok(!(await getOrderScreen(other.id))!.menu.items.some((i) => i.id === dish.id), "a deleted item isn't on the order screen's menu");
      assert.deepEqual((await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).modifiers, [{ id: hot.id, group: "E2E Spice", name: "Hot", price: "1.50" }], "the billed line keeps its snapshot");
    });

    test("recipes only ever join a MENU_ITEM to an INGREDIENT; retail products get no recipe or food cost", async () => {
      const [[bad]] = await Promise.all([
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM RecipeLine r JOIN Product m ON m.id = r.menuItemId JOIN Product i ON i.id = r.ingredientId
          WHERE r.deletedAt IS NULL AND (m.productType <> 'MENU_ITEM' OR i.productType <> 'INGREDIENT')`,
      ]);
      assert.equal(Number(bad.n), 0);
      const retail = await prisma.product.findFirst({ where: { productType: "STANDARD", deletedAt: null }, select: { code: true } });
      if (retail) assert.equal((await list(retail.code)).rows.length, 0, "a retail product never shows a food cost (it's not in the menu list)");
    });
  });
});
