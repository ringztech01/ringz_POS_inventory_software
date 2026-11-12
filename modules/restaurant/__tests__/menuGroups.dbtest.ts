// Food › POS buttons (services/menuGroups.ts) against a real database: the
// group tree's rules, placing buttons (swap, arrivals, nothing shifting
// later), taking dishes off, groups from categories, the after-add setting,
// the quick notes and what the POS menu then shows. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/menuGroups.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { autoGroupId } from "../lib/posMenu";
import type { MenuGroupInput } from "../schemas/menuGroup";
import {
  createMenuGroup,
  deleteMenuGroup,
  groupsFromCategories,
  moveMenuGroupRank,
  placeMenuButton,
  setPosSettings,
  setQuickNotes,
  unplaceDish,
  updateMenuGroup,
} from "../server/services/menuGroups";
import { getMenu } from "../server/queries/orderScreen";
import { getQuickNotes } from "../server/queries/menuGroups";
import { getPosSettings } from "../server/queries/posScreen";
import { DEFAULT_QUICK_NOTES } from "../lib/optionFlow";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const dish: Record<string, string> = {};
let categoryId = "";
let warehouseId = "";

const input = (name: string, extra: Partial<MenuGroupInput> = {}): MenuGroupInput => ({ name, department: "FOOD", parentId: null, colour: null, ...extra });
const groupNamed = (name: string) => prisma.menuGroup.findFirstOrThrow({ where: { name, deletedAt: null } });
const cellsOf = async (ids: string[]) =>
  Object.fromEntries((await prisma.product.findMany({ where: { id: { in: ids } }, select: { name: true, menuGroupId: true, menuGridPosition: true } })).map((p) => [p.name, [p.menuGroupId, p.menuGridPosition]]));

describe("POS buttons (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    // Start clean: no groups (the copy may hold the user's own).
    await prisma.product.updateMany({ data: { menuGroupId: null, menuGridPosition: null } });
    await prisma.menuGroup.deleteMany({});
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const bar = await prisma.kitchenStation.findFirst({ where: { code: "BAR", deletedAt: null } });
    categoryId = (await prisma.category.create({ data: { name: "Buttons check" }, select: { id: true } })).id;
    for (const [key, name, onBar] of [["jollof", "Btn Jollof", false], ["fried", "Btn Fried Rice", false], ["white", "Btn White Rice", false], ["star", "Btn Star", true]] as const) {
      dish[key] = (
        await prisma.product.create({
          data: { name, code: `BTN-${key}-${Date.now()}`, price: 10, categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId: onBar ? (bar?.id ?? null) : null, prepStation: onBar ? "BAR" : "KITCHEN" },
          select: { id: true },
        })
      ).id;
    }
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  });
  after(() => prisma.$disconnect());

  test("groups: a tree; a sub-group takes its parent's side; no loops", async () => {
    assert.ok((await createMenuGroup(input("Rice"))).ok);
    assert.ok((await createMenuGroup(input("Soups"))).ok);
    const rice = await groupNamed("Rice");
    assert.ok((await createMenuGroup(input("Jollof", { parentId: rice.id, department: "BAR" }))).ok);
    const jollof = await groupNamed("Jollof");
    assert.deepEqual([jollof.parentId, jollof.department, (await groupNamed("Soups")).rank], [rice.id, "FOOD", 1]);
    // Rice can't go inside Jollof (its own sub-group), nor inside itself.
    const loop = await updateMenuGroup(rice.id, input("Rice", { parentId: jollof.id }));
    assert.equal(!loop.ok && loop.fieldErrors?.parentId?.[0], "A group can't go inside itself or one of its own sub-groups.");
    assert.equal(!(await updateMenuGroup(rice.id, input("Rice", { parentId: rice.id }))).ok, true);
    // A missing parent.
    const gone = await createMenuGroup(input("Orphan", { parentId: "nope" }));
    assert.equal(!gone.ok && gone.fieldErrors?.parentId?.[0], "That group isn't there any more. Pick another.");
  });

  test("a top group moved to Bar takes its sub-groups along; colours are kept as set", async () => {
    const rice = await groupNamed("Rice");
    assert.ok((await updateMenuGroup(rice.id, input("Rice", { department: "BAR", colour: "#123abc" }))).ok);
    const [after, jollof] = await Promise.all([groupNamed("Rice"), groupNamed("Jollof")]);
    assert.deepEqual([after.department, after.colour, jollof.department, after.gridPosition], ["BAR", "#123abc", "BAR", null]);
    assert.ok((await updateMenuGroup(rice.id, input("Rice"))).ok);
    assert.equal((await groupNamed("Jollof")).department, "FOOD");
  });

  test("rank: up and down among its own siblings only", async () => {
    const order = async () => (await prisma.menuGroup.findMany({ where: { parentId: null, department: "FOOD", deletedAt: null }, orderBy: { rank: "asc" } })).map((g) => g.name);
    const rice = await groupNamed("Rice");
    assert.deepEqual(await order(), ["Soups", "Rice"]);
    assert.ok((await moveMenuGroupRank(rice.id, "up")).ok);
    assert.deepEqual(await order(), ["Rice", "Soups"]);
    assert.ok((await moveMenuGroupRank(rice.id, "up")).ok, "already first: nothing to do");
    assert.deepEqual(await order(), ["Rice", "Soups"]);
  });

  test("placing: a dish joins a group at a cell; every button then has a fixed cell; a drop on a taken cell swaps", async () => {
    const rice = await groupNamed("Rice");
    const jollof = await groupNamed("Jollof");
    assert.ok((await placeMenuButton({ kind: "item", id: dish.fried, department: "FOOD", groupId: rice.id, cell: 4 })).ok);
    assert.ok((await placeMenuButton({ kind: "item", id: dish.white, department: "FOOD", groupId: rice.id, cell: 4 })).ok, "arrives on a taken cell");
    // White took cell 4; Fried Rice (arriving earlier) moved to the first free cell — after the sub-group Jollof, saved at 0.
    assert.deepEqual(await cellsOf([dish.fried, dish.white]), { "Btn Fried Rice": [rice.id, 1], "Btn White Rice": [rice.id, 4] });
    assert.equal((await groupNamed("Jollof")).gridPosition, 0);
    // A move within the grid swaps.
    assert.ok((await placeMenuButton({ kind: "group", id: jollof.id, department: "FOOD", groupId: rice.id, cell: 4 })).ok);
    assert.deepEqual([(await groupNamed("Jollof")).gridPosition, (await cellsOf([dish.white]))["Btn White Rice"][1]], [4, 0]);
    // A dish needs a group; a group can't be dragged in from another grid.
    assert.equal((await placeMenuButton({ kind: "item", id: dish.jollof, department: "FOOD", groupId: null, cell: 0 })).ok, false);
    assert.equal((await placeMenuButton({ kind: "group", id: jollof.id, department: "FOOD", groupId: null, cell: 0 })).ok, false);
    // Groups at the department's home.
    const soups = await groupNamed("Soups");
    assert.ok((await placeMenuButton({ kind: "group", id: soups.id, department: "FOOD", groupId: null, cell: 7 })).ok);
    assert.deepEqual([(await groupNamed("Rice")).gridPosition, (await groupNamed("Soups")).gridPosition], [0, 7]);
  });

  test("the POS menu: the tree, cells as placed, an unplaced dish under its category on its station's side", async () => {
    const { menu } = await getMenu(warehouseId);
    const rice = await groupNamed("Rice");
    const jollof = await groupNamed("Jollof");
    assert.deepEqual(menu.tree.grids[rice.id].slice(0, 5), [{ kind: "item", id: dish.white }, { kind: "item", id: dish.fried }, null, null, { kind: "group", id: jollof.id }]);
    assert.equal(menu.tree.dishGroup[dish.star], autoGroupId("BAR", categoryId));
    assert.equal(menu.items.find((i) => i.id === dish.star)?.department, "BAR");
    assert.equal(menu.items.find((i) => i.id === dish.fried)?.department, "FOOD");
  });

  test("taking a dish off, and deleting a group (refused with sub-groups; its dishes go back to not placed)", async () => {
    assert.ok((await unplaceDish(dish.fried)).ok);
    assert.deepEqual((await cellsOf([dish.fried]))["Btn Fried Rice"], [null, null]);
    const rice = await groupNamed("Rice");
    const refused = await deleteMenuGroup(rice.id);
    assert.equal(!refused.ok && refused.error, "It has 1 sub-group. Move or delete it first.");
    const jollof = await groupNamed("Jollof");
    assert.ok((await placeMenuButton({ kind: "item", id: dish.jollof, department: "FOOD", groupId: jollof.id, cell: 2 })).ok);
    const deleted = await deleteMenuGroup(jollof.id);
    assert.deepEqual([deleted.ok, deleted.ok && deleted.dishes], [true, 1]);
    assert.deepEqual((await cellsOf([dish.jollof]))["Btn Jollof"], [null, null]);
    assert.equal((await deleteMenuGroup(jollof.id)).ok, false, "already gone");
  });

  test("groups from categories: each unplaced dish into a top group named after its category, on its side", async () => {
    const result = await groupsFromCategories();
    assert.ok(result.ok);
    const made = await prisma.menuGroup.findMany({ where: { name: "Buttons check", deletedAt: null }, orderBy: { department: "asc" } });
    assert.deepEqual(made.map((g) => g.department), ["FOOD", "BAR"]);
    const cells = await cellsOf([dish.fried, dish.jollof, dish.star, dish.white]);
    assert.equal(cells["Btn Star"][0], made.find((g) => g.department === "BAR")!.id);
    assert.equal(cells["Btn Fried Rice"][0], made.find((g) => g.department === "FOOD")!.id);
    assert.equal(cells["Btn White Rice"][0], (await groupNamed("Rice")).id, "a placed dish stays where it is");
    const again = await groupsFromCategories();
    assert.deepEqual([again.ok, again.ok && again.groups, again.ok && again.dishes], [true, 0, 0]);
  });

  test("quick notes: the defaults until a list is saved; an empty list stays empty", async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantQuickNotes: Prisma.DbNull } });
    assert.deepEqual(await getQuickNotes(), DEFAULT_QUICK_NOTES);
    assert.ok((await setQuickNotes(["No salt", "Well done"])).ok);
    assert.deepEqual(await getQuickNotes(), ["No salt", "Well done"]);
    assert.ok((await setQuickNotes([])).ok);
    assert.deepEqual(await getQuickNotes(), []);
  });

  test("the touch POS settings: after a dish, after Send, auto-lock", async () => {
    assert.deepEqual(await getPosSettings(), { returnHome: false, sendToFloor: true, lockSeconds: 0, lockSecondsManager: 300, lightTheme: false }, "the defaults");
    assert.ok((await setPosSettings({ returnHome: true, sendToFloor: false, lockSeconds: 60, lockSecondsManager: 600, lightTheme: true })).ok);
    assert.deepEqual(await getPosSettings(), { returnHome: true, sendToFloor: false, lockSeconds: 60, lockSecondsManager: 600, lightTheme: true });
    assert.equal((await getBusinessSettings()).restaurantPosReturnHome, true, "the menu pad reads it from the business settings");
    assert.ok((await setPosSettings({ returnHome: false, sendToFloor: true, lockSeconds: 0, lockSecondsManager: 300, lightTheme: false })).ok);
  });
});
