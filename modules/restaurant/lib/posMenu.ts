import { DEPARTMENTS, GRID_SLOTS, groupColor, type Department } from "./posGrid";

// The touch POS's button tree (Part 6e Step 2): each department's groups,
// their sub-groups and dishes, and where every button sits. Pure — the
// server builds it for the POS, the layout editor uses the same placement.

export type MenuGroupRow = {
  id: string;
  name: string;
  parentId: string | null;
  department: Department;
  colour: string | null;
  rank: number;
  gridPosition: number | null;
};

export type MenuDishRow = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  // Its group (null: not placed yet) and cell there.
  groupId: string | null;
  gridPosition: number | null;
  // Its station's side (lib/posGrid departmentOf): where an unplaced dish shows.
  stationDepartment: Department;
};

export type PosCell = { kind: "group" | "item"; id: string } | null;

export type PosGroupNode = {
  id: string;
  name: string;
  parentId: string | null;
  department: Department;
  colour: string;
  // Made up for dishes not in a group yet: one per category (not editable).
  auto: boolean;
};

export type PosMenuTree = {
  groups: Record<string, PosGroupNode>;
  // A department's groups row: its top groups by rank.
  row: Record<Department, string[]>;
  // A department's home grid (its top groups) and each group's grid (its
  // sub-groups and dishes) — cells in order, padded to whole pages of 30.
  home: Record<Department, PosCell[]>;
  grids: Record<string, PosCell[]>;
  // Each dish's group (an auto group for an unplaced dish) and department.
  dishGroup: Record<string, string>;
  dishDepartment: Record<string, Department>;
};

export const autoGroupId = (department: Department, categoryId: string) => `auto:${department}:${categoryId}`;
export const isAutoGroup = (id: string) => id.startsWith("auto:");

// Buttons into cells: one with a free cell of its own keeps it; the rest
// (no cell, or a cell already taken) fill the free cells in the order given.
// Always whole pages: a button's place never depends on the others.
export function placeCells<T extends { position: number | null }>(buttons: readonly T[]): (T | null)[] {
  const fixed = new Map<number, T>();
  const loose: T[] = [];
  for (const button of buttons) {
    const at = button.position;
    if (at !== null && Number.isInteger(at) && at >= 0 && !fixed.has(at)) fixed.set(at, button);
    else loose.push(button);
  }
  const cells: (T | null)[] = [];
  const highest = fixed.size ? Math.max(...fixed.keys()) : -1;
  let free = 0;
  for (const button of loose) {
    while (fixed.has(free)) free++;
    fixed.set(free, button);
    free++;
  }
  const last = Math.max(highest, ...fixed.keys(), -1);
  const length = Math.max(1, Math.ceil((last + 1) / GRID_SLOTS)) * GRID_SLOTS;
  for (let i = 0; i < length; i++) cells.push(fixed.get(i) ?? null);
  return cells;
}

const byRankThenName = (a: { rank: number; name: string }, b: { rank: number; name: string }) => a.rank - b.rank || a.name.localeCompare(b.name);

export function buildPosMenu(groupRows: readonly MenuGroupRow[], dishes: readonly MenuDishRow[]): PosMenuTree {
  const live = new Map(groupRows.map((g) => [g.id, g]));
  // A parent that's gone, or a loop (A in B in A): the group shows at the
  // top instead.
  const rawParent = (g: MenuGroupRow) => (g.parentId && live.has(g.parentId) ? g.parentId : null);
  const looped = new Set<string>();
  for (const g of groupRows) {
    const seen = new Set<string>([g.id]);
    for (let up = rawParent(g); up; up = rawParent(live.get(up)!)) {
      if (seen.has(up)) {
        looped.add(g.id);
        break;
      }
      seen.add(up);
    }
  }
  const parentOf = (g: MenuGroupRow) => (looped.has(g.id) ? null : rawParent(g));
  const rootOf = (g: MenuGroupRow) => {
    let at = g;
    for (let up = parentOf(at); up; up = parentOf(at)) at = live.get(up)!;
    return at;
  };
  // A sub-group is always in its top group's department.
  const departmentOf = (g: MenuGroupRow) => rootOf(g).department;

  // Unplaced dishes (or in a group that's gone): an auto group per category,
  // after the department's own groups.
  const autos = new Map<string, MenuGroupRow>();
  const dishGroup: Record<string, string> = {};
  const dishDepartment: Record<string, Department> = {};
  for (const dish of [...dishes].sort((a, b) => a.categoryName.localeCompare(b.categoryName))) {
    const group = dish.groupId ? live.get(dish.groupId) : undefined;
    if (group) {
      dishGroup[dish.id] = group.id;
      dishDepartment[dish.id] = departmentOf(group);
      continue;
    }
    const id = autoGroupId(dish.stationDepartment, dish.categoryId);
    if (!autos.has(id)) autos.set(id, { id, name: dish.categoryName, parentId: null, department: dish.stationDepartment, colour: null, rank: Number.MAX_SAFE_INTEGER, gridPosition: null });
    dishGroup[dish.id] = id;
    dishDepartment[dish.id] = dish.stationDepartment;
  }

  const all = [...groupRows, ...autos.values()];
  const children = new Map<string | null, MenuGroupRow[]>();
  for (const g of all) {
    const key = live.has(g.id) ? parentOf(g) : null;
    children.set(key, [...(children.get(key) ?? []), g]);
  }
  for (const list of children.values()) list.sort(byRankThenName);

  const row = Object.fromEntries(DEPARTMENTS.map((d) => [d, [] as string[]])) as Record<Department, string[]>;
  const groups: Record<string, PosGroupNode> = {};
  // Colour: its own, else its parent's, else its department's n-th shade
  // (n: its place in the department's row).
  const colourOf = (g: MenuGroupRow): string => {
    if (g.colour) return g.colour;
    const up = live.has(g.id) ? parentOf(g) : null;
    if (up) return colourOf(live.get(up)!);
    const department = live.has(g.id) ? departmentOf(g) : g.department;
    return groupColor(department, row[department].indexOf(g.id));
  };
  for (const g of children.get(null) ?? []) row[live.has(g.id) ? departmentOf(g) : g.department].push(g.id);
  for (const g of all) {
    const auto = !live.has(g.id);
    groups[g.id] = { id: g.id, name: g.name, parentId: auto ? null : parentOf(g), department: auto ? g.department : departmentOf(g), colour: colourOf(g), auto };
  }

  const groupCell = (g: MenuGroupRow) => ({ kind: "group" as const, id: g.id, position: g.gridPosition });
  const strip = (cells: ({ kind: "group" | "item"; id: string; position: number | null } | null)[]): PosCell[] => cells.map((c) => (c ? { kind: c.kind, id: c.id } : null));

  const home = Object.fromEntries(
    DEPARTMENTS.map((d) => [d, strip(placeCells((children.get(null) ?? []).filter((g) => groups[g.id].department === d).map(groupCell)))]),
  ) as Record<Department, PosCell[]>;

  const dishesIn = new Map<string, MenuDishRow[]>();
  for (const dish of dishes) dishesIn.set(dishGroup[dish.id], [...(dishesIn.get(dishGroup[dish.id]) ?? []), dish]);
  const grids: Record<string, PosCell[]> = {};
  for (const g of all) {
    const subGroups = (children.get(g.id) ?? []).map(groupCell);
    const items = [...(dishesIn.get(g.id) ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ kind: "item" as const, id: d.id, position: d.gridPosition }));
    grids[g.id] = strip(placeCells([...subGroups, ...items]));
  }

  return { groups, row, home, grids, dishGroup, dishDepartment };
}

// The groups above one (top first), for the breadcrumb and Back.
export function groupPath(tree: Pick<PosMenuTree, "groups">, id: string | null): string[] {
  const path: string[] = [];
  let at = id ? tree.groups[id] : undefined;
  while (at && path.length < 50) {
    path.unshift(at.id);
    at = at.parentId ? tree.groups[at.parentId] : undefined;
  }
  return path;
}
