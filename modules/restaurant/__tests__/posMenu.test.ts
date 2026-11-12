// Run with: npx tsx --test modules/restaurant/__tests__/posMenu.test.ts
// The touch POS's button tree (lib/posMenu.ts): placement, the tree under
// each department, colours, and dishes not placed yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPARTMENT_SHADES } from "../lib/posGrid";
import { autoGroupId, buildPosMenu, groupPath, placeCells, type MenuDishRow, type MenuGroupRow } from "../lib/posMenu";

const b = (id: string, position: number | null) => ({ id, position });
const ids = (cells: ({ id: string } | null)[]) => cells.map((c) => c?.id ?? null);

test("placement: a button keeps its cell; the rest fill the gaps in order; whole pages", () => {
  const cells = placeCells([b("a", 2), b("b", null), b("c", 0), b("d", null)]);
  assert.equal(cells.length, 30);
  assert.deepEqual(ids(cells).slice(0, 5), ["c", "b", "a", "d", null]);
  // Two asking for one cell: the first keeps it, the second takes the next free.
  assert.deepEqual(ids(placeCells([b("x", 1), b("y", 1)])).slice(0, 3), ["y", "x", null]);
  // A cell on page 2: two pages, page 1 left with its gaps.
  const paged = placeCells([b("far", 31), b("near", null)]);
  assert.equal(paged.length, 60);
  assert.deepEqual([paged[0]?.id, paged[31]?.id, paged[30]], ["near", "far", null]);
  assert.equal(placeCells([]).length, 30);
  // Nonsense cells (negative, fractions) count as none.
  assert.deepEqual(ids(placeCells([b("neg", -3), b("half", 1.5)])).slice(0, 2), ["neg", "half"]);
});

const G = (id: string, name: string, parentId: string | null, department: "FOOD" | "BAR", rank = 0, gridPosition: number | null = null, colour: string | null = null): MenuGroupRow => ({ id, name, parentId, department, colour, rank, gridPosition });
const D = (id: string, name: string, groupId: string | null, gridPosition: number | null = null, categoryId = "c-misc", categoryName = "Misc", stationDepartment: "FOOD" | "BAR" = "FOOD"): MenuDishRow => ({ id, name, categoryId, categoryName, groupId, gridPosition, stationDepartment });

const groups = [
  G("rice", "Rice", null, "FOOD", 1),
  G("soups", "Soups", null, "FOOD", 0, 5),
  G("jollof", "Jollof", "rice", "BAR", 0, null, "#123456"), // department follows the top group
  G("party", "Party packs", "jollof", "FOOD"),
  G("beer", "Beer", null, "BAR", 0),
];
const dishes = [
  D("j1", "Jollof & Chicken", "jollof", 3),
  D("j2", "Jollof & Beef", "jollof"),
  D("w", "White Rice", "rice"),
  D("star", "Star Lager", "beer"),
  D("egusi", "Egusi", "soups"),
  D("chapman", "Chapman", null, null, "c-mock", "Mocktails", "BAR"),
  D("ghost", "Moved dish", "deleted-group", null, "c-sides", "Sides", "FOOD"),
];

test("the tree: rows by rank, sub-groups in the top group's department", () => {
  const tree = buildPosMenu(groups, dishes);
  assert.deepEqual(tree.row.FOOD, ["soups", "rice", autoGroupId("FOOD", "c-sides")]);
  assert.deepEqual(tree.row.BAR, ["beer", autoGroupId("BAR", "c-mock")]);
  assert.equal(tree.groups.jollof.department, "FOOD");
  assert.equal(tree.groups.party.department, "FOOD");
  assert.equal(tree.dishDepartment.j1, "FOOD");
  // Home: Rice auto-placed first, Soups at its cell 5, the auto group after.
  assert.deepEqual(ids(tree.home.FOOD).slice(0, 6), ["rice", autoGroupId("FOOD", "c-sides"), null, null, null, "soups"]);
  // A group's grid: its sub-groups first, then its dishes (by name), fixed cells kept.
  assert.deepEqual(tree.grids.rice.slice(0, 2), [{ kind: "group", id: "jollof" }, { kind: "item", id: "w" }]);
  assert.deepEqual(ids(tree.grids.jollof).slice(0, 4), ["party", "j2", null, "j1"]);
});

test("dishes not in a group show under their category, on their station's side", () => {
  const tree = buildPosMenu(groups, dishes);
  const mock = autoGroupId("BAR", "c-mock");
  assert.deepEqual([tree.dishGroup.chapman, tree.groups[mock].name, tree.groups[mock].auto], [mock, "Mocktails", true]);
  // A dish whose group was deleted counts as not placed.
  assert.equal(tree.dishGroup.ghost, autoGroupId("FOOD", "c-sides"));
  assert.deepEqual(ids(tree.grids[mock]), ["chapman", ...Array(29).fill(null)]);
});

test("colours: its own, else its parent's, else the department's shade by its place in the row", () => {
  const tree = buildPosMenu(groups, dishes);
  assert.equal(tree.groups.soups.colour, DEPARTMENT_SHADES.FOOD[0]);
  assert.equal(tree.groups.rice.colour, DEPARTMENT_SHADES.FOOD[1]);
  assert.equal(tree.groups.jollof.colour, "#123456");
  assert.equal(tree.groups.party.colour, "#123456");
  assert.equal(tree.groups.beer.colour, DEPARTMENT_SHADES.BAR[0]);
  assert.equal(tree.groups[autoGroupId("BAR", "c-mock")].colour, DEPARTMENT_SHADES.BAR[1]);
});

test("the path to a group (breadcrumb, Back), and a loop can't hang it", () => {
  const tree = buildPosMenu(groups, dishes);
  assert.deepEqual(groupPath(tree, "party"), ["rice", "jollof", "party"]);
  assert.deepEqual(groupPath(tree, null), []);
  const loop = buildPosMenu([G("a", "A", "b", "FOOD"), G("b", "B", "a", "FOOD")], []);
  assert.ok(groupPath(loop, "a").length <= 50);
});
