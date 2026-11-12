// The floor plan's geometry (the Floor Plan Editor design): every table and
// fixture is stored in metres from the room's top-left corner, so each
// screen draws it in proportion, whatever its size. Pure.

export type TableShape = "ROUND" | "SQUARE" | "RECT" | "BOOTH";

// A new room, and its dot grid (metres).
export const DEFAULT_ROOM = { widthM: 12, heightM: 8, gridM: 0.5 } as const;

// Each shape's starting size (metres): the editor's palette.
export const SHAPE_SIZE: Record<TableShape, readonly [number, number]> = {
  ROUND: [1.2, 1.2],
  SQUARE: [1.4, 1.4],
  RECT: [2.6, 1.4],
  BOOTH: [2.2, 1.6],
};

// A table with no layout yet takes its shape from its seats: up to 2 round,
// up to 4 square, more a long table (8 and up a longer one).
export function shapeForSeats(seats: number): { shape: TableShape; w: number; h: number } {
  if (seats <= 2) return { shape: "ROUND", w: 1.2, h: 1.2 };
  if (seats <= 4) return { shape: "SQUARE", w: 1.4, h: 1.4 };
  if (seats <= 6) return { shape: "RECT", w: 2.6, h: 1.4 };
  return { shape: "RECT", w: 3.2, h: 1.6 };
}

// The tidy grid tables start in (the add_floor_plan migration places the
// tables that were there this way): three to a row, 3.8 m apart, rows 2.2 m
// apart, 0.4 m from the walls — the longest default table (3.2 m) clears
// the next by 0.6 m, and the row fits a 12 m room.
export const GRID_START_M = 0.4;
export const GRID_COLUMNS = 3;
export const GRID_STEP_X_M = 3.8;
export const GRID_STEP_Y_M = 2.2;

export function gridSlot(index: number): { x: number; y: number } {
  return {
    x: round2(GRID_START_M + (index % GRID_COLUMNS) * GRID_STEP_X_M),
    y: round2(GRID_START_M + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y_M),
  };
}

// A room deep enough for `count` tables in that grid (at least the default).
export function roomHeightFor(count: number): number {
  return Math.max(DEFAULT_ROOM.heightM, round2(GRID_START_M + Math.ceil(count / GRID_COLUMNS) * GRID_STEP_Y_M));
}

export const round2 = (value: number) => Math.round(value * 100) / 100;

export type Box = { x: number; y: number; w: number; h: number };

// Two boxes overlap (touching edges don't).
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Where a new table goes: the first grid slot (gridSlot) where a `w` × `h`
// table overlaps none of `taken` — further down the room if it's full.
export function firstFreeSlot(taken: readonly Box[], w: number, h: number): { x: number; y: number } {
  for (let index = 0; index < 500; index++) {
    const slot = gridSlot(index);
    if (!taken.some((box) => boxesOverlap({ ...slot, w, h }, box))) return slot;
  }
  return gridSlot(500);
}

// ---- The editor (Step 2) ------------------------------------------------------

export type FixtureType = "BAR_COUNTER" | "KITCHEN_PASS" | "ENTRANCE" | "WALL" | "PILLAR" | "STAGE" | "WINDOW" | "LABEL";

// Each fixture's palette label and starting size (metres), in palette order
// (the design's five first).
export const FIXTURE_DEFAULTS: Record<FixtureType, { label: string; w: number; h: number }> = {
  BAR_COUNTER: { label: "Bar counter", w: 4, h: 0.9 },
  KITCHEN_PASS: { label: "Kitchen pass", w: 2.8, h: 1 },
  ENTRANCE: { label: "Entrance", w: 2.4, h: 0.5 },
  PILLAR: { label: "Pillar", w: 0.5, h: 0.5 },
  WALL: { label: "Wall", w: 3, h: 0.2 },
  STAGE: { label: "Stage", w: 3, h: 2 },
  WINDOW: { label: "Window", w: 2, h: 0.2 },
  LABEL: { label: "Label", w: 2, h: 0.6 },
};
export const FIXTURE_TYPES = Object.keys(FIXTURE_DEFAULTS) as FixtureType[];

// The editor's table palette: [label, shape, seats, w, h].
export const TABLE_PALETTE: readonly (readonly [string, TableShape, number, number, number])[] = [
  ["Round · 2", "ROUND", 2, 1.2, 1.2],
  ["Square · 4", "SQUARE", 4, 1.4, 1.4],
  ["Rect · 6", "RECT", 6, 2.6, 1.4],
  ["Rect · 8", "RECT", 8, 3.2, 1.6],
  ["Booth · 6", "BOOTH", 6, 2.2, 1.6],
];

// Limits: the smallest a table or fixture can be, seats, the room.
export const MIN_SIZE_M = { table: 0.5, fixture: 0.2 } as const;
export const MAX_SEATS = 30; // as on Restaurant › Tables (schemas/table.ts)
export const ROOM_LIMITS_M = { min: 2, max: 100 } as const;
// The dot grid (and snap step) a room can use, in metres.
export const GRID_SIZES_M = [0.25, 0.5, 1] as const;
// A room size in steps of 10 cm ("12.5").
export const isTenthMetre = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
export const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

export type Placed = Box & { rotation: number };
export type Room = { widthM: number; heightM: number };

// On the grid (snap on), else to the nearest 10 cm.
export function snap(value: number, gridM: number, on: boolean): number {
  return on ? round2(Math.round(value / gridM) * gridM) : round2(Math.round(value * 10) / 10);
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// The box a rotated item fills (turned about its centre) — what overlap and
// the room's walls are checked against.
export function rotatedBounds(item: Placed): Box {
  const turn = (((item.rotation % 360) + 360) % 360) * (Math.PI / 180);
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const w = item.w * cos + item.h * sin;
  const h = item.w * sin + item.h * cos;
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Inside the room: moved (not resized) so its rotated box fits, when it can.
export function clampToRoom<T extends Placed>(item: T, room: Room): T {
  const bounds = rotatedBounds(item);
  const dx = bounds.x < 0 ? -bounds.x : bounds.x + bounds.w > room.widthM ? room.widthM - (bounds.x + bounds.w) : 0;
  const dy = bounds.y < 0 ? -bounds.y : bounds.y + bounds.h > room.heightM ? room.heightM - (bounds.y + bounds.h) : 0;
  return dx || dy ? { ...item, x: round2(item.x + dx), y: round2(item.y + dy) } : item;
}

const EPS = 0.005;
// Inside the room (its rotated box), allowing for rounding.
export function insideRoom(item: Placed, room: Room): boolean {
  const b = rotatedBounds(item);
  return b.x >= -EPS && b.y >= -EPS && b.x + b.w <= room.widthM + EPS && b.y + b.h <= room.heightM + EPS;
}

// Two items overlap when their rotated boxes share area (more than rounding).
export function itemsOverlap(a: Placed, b: Placed): boolean {
  const p = rotatedBounds(a);
  const q = rotatedBounds(b);
  return p.x < q.x + q.w - EPS && p.x + p.w > q.x + EPS && p.y < q.y + q.h - EPS && p.y + p.h > q.y + EPS;
}

// The tables (by key) that overlap another table. Fixtures may overlap.
export function overlappingTables<T extends Placed & { key: string }>(tables: readonly T[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tables.length; i++)
    for (let j = i + 1; j < tables.length; j++)
      if (itemsOverlap(tables[i], tables[j])) {
        out.add(tables[i].key);
        out.add(tables[j].key);
      }
  return out;
}

// A table number as compared (the database's collation ignores case).
export const numberKey = (name: string) => name.trim().toLowerCase();

// The tables (by key) whose number another table also has — across every
// area — or that have none.
export function duplicateNumbers(tables: readonly { key: string; name: string }[]): Set<string> {
  const count = new Map<string, number>();
  for (const t of tables) count.set(numberKey(t.name), (count.get(numberKey(t.name)) ?? 0) + 1);
  return new Set(tables.filter((t) => !numberKey(t.name) || (count.get(numberKey(t.name)) ?? 0) > 1).map((t) => t.key));
}

// The next table number in an area: its prefix and one more than the
// highest number after it there ("T" → T6); with no prefix, one more than
// the highest plain number anywhere — never one already taken.
export function nextTableNumber(prefix: string | null, areaNames: readonly string[], allNames: readonly string[]): string {
  const p = (prefix ?? "").trim();
  const pool = p ? areaNames : allNames;
  // The number after the prefix (digits only; prefixes are letters).
  const numberAfter = (name: string) => {
    const n = name.trim();
    if (n.slice(0, p.length).toLowerCase() !== p.toLowerCase()) return 0;
    const rest = n.slice(p.length);
    return /^[0-9]+$/.test(rest) ? Number(rest) : 0;
  };
  let next = Math.max(0, ...pool.map(numberAfter)) + 1;
  const taken = new Set(allNames.map(numberKey));
  while (taken.has(numberKey(`${p}${next}`))) next++;
  return `${p}${next}`;
}

// The first spot (on the grid, from the top-left) where a `w` × `h` item
// overlaps nothing already there; the top-left corner when the room's full.
export function firstFreeSpot(items: readonly Placed[], w: number, h: number, room: Room, gridM: number): { x: number; y: number } {
  const step = Math.max(gridM, 0.1);
  for (let y = step; y + h <= room.heightM + EPS; y = round2(y + step))
    for (let x = step; x + w <= room.widthM + EPS; x = round2(x + step))
      if (!items.some((other) => itemsOverlap({ x, y, w, h, rotation: 0 }, other))) return { x, y };
  return { x: 0, y: 0 };
}

// Metres → a share of the room (the service view draws in percentages, so
// every screen keeps the same proportions) and back.
export function toPercent(box: Box, room: Room): Box {
  return { x: (box.x / room.widthM) * 100, y: (box.y / room.heightM) * 100, w: (box.w / room.widthM) * 100, h: (box.h / room.heightM) * 100 };
}
export function fromPercent(box: Box, room: Room): Box {
  return { x: round2((box.x / 100) * room.widthM), y: round2((box.y / 100) * room.heightM), w: round2((box.w / 100) * room.widthM), h: round2((box.h / 100) * room.heightM) };
}
