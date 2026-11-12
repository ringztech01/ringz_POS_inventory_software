import type { PrepStation } from "@prisma/client";

// The touch POS's menu pad (Part 6e): two departments, each with its groups,
// and a fixed 6 × 5 button grid that pages. Pure — shared by the server
// (which department a dish is in) and the screen (what each page shows).

export type Department = "FOOD" | "BAR";
export const DEPARTMENTS: readonly Department[] = ["FOOD", "BAR"];
export const DEPARTMENT_LABEL: Record<Department, string> = { FOOD: "Food", BAR: "Bar" };

// A dish not in a menu group yet (lib/posMenu) is Bar when it's made at the
// Bar station (code BAR) — or, with no station, its old prep station says
// Bar — and Food otherwise.
export function departmentOf(stationCode: string | null, prepStation: PrepStation | null): Department {
  if (stationCode) return stationCode.toUpperCase() === "BAR" ? "BAR" : "FOOD";
  return prepStation === "BAR" ? "BAR" : "FOOD";
}

export const GRID_COLUMNS = 6;
export const GRID_ROWS = 5;
export const GRID_SLOTS = GRID_COLUMNS * GRID_ROWS;

export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(count / GRID_SLOTS));
}

// One page of the grid: always GRID_SLOTS cells, empty ones null — so a
// button's place never depends on how many others there are.
export function gridPage<T>(items: readonly T[], page: number): (T | null)[] {
  const start = Math.min(Math.max(0, page), pageCount(items.length) - 1) * GRID_SLOTS;
  return Array.from({ length: GRID_SLOTS }, (_, i) => items[start + i] ?? null);
}

// Solid button colours from the Restaurant POS design (white text on each
// passes 4.5 : 1): Food's warm earths, Bar's blues and wines. A group takes
// the n-th shade of its department (unless it has its own colour) and its
// dishes take the group's.
export const DEPARTMENT_SHADES: Record<Department, readonly string[]> = {
  FOOD: ["#9A3B12", "#A0560B", "#8E2F2A", "#76601A", "#8A4B1F", "#5E6A1C", "#8A3157"],
  BAR: ["#1F4E8C", "#1B6676", "#3B3F8F", "#6B2340", "#2B6A57", "#5A5F1E", "#6A4A2E"],
};

// The Food / Bar keys when lit.
export const DEPARTMENT_COLOR: Record<Department, string> = { FOOD: "#C2611A", BAR: "#2457A6" };

export function groupColor(department: Department, index: number): string {
  const shades = DEPARTMENT_SHADES[department];
  return shades[((index % shades.length) + shades.length) % shades.length];
}
