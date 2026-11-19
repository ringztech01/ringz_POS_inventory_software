// An area that's never been saved in the floor plan editor (floorPlanSavedAt
// null — layoutVersion can't tell: adding a table on the Tables page moves it)
// still gets a drawn floor (6g follow-up 3): its tables in a neat grid by
// table number, each its own size and shape, upright, the grid centred in
// the room. Every floor uses this one layout for such an area — the tablet,
// the desktop Tables screen's floor view — and the editor starts from it;
// saving there stores real places and from then on they're used instead.
// Pure: the same tables give the same floor everywhere.

export type AutoTable = { id: string; name: string; w: number; h: number };
export type AutoRoom = { widthM: number; heightM: number };
export type AutoPlace = { x: number; y: number; w: number; h: number; rotation: number };

// From the room's walls, and between tables (metres).
export const AUTO_MARGIN_M = 0.5;
export const AUTO_GAP_M = 0.8;

const round2 = (n: number) => Math.round(n * 100) / 100;

// "T2" before "T10"; "Bar 1" before "Bar 2"; then the id, so it never changes.
export function byTableNumber<T extends { id: string; name: string }>(tables: readonly T[]): T[] {
  return [...tables].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id));
}

// The grid: as many across as fit, the rows filling down in table-number
// order, the shape closest to the room's. A room too small for them all
// grows (for the drawing; the editor starts from it, saving keeps it).
export function autoFloor(tables: readonly AutoTable[], room: AutoRoom): { room: AutoRoom; places: Record<string, AutoPlace> } {
  if (tables.length === 0) return { room, places: {} };
  const ordered = byTableNumber(tables);
  const cellW = Math.max(...ordered.map((t) => t.w)) + AUTO_GAP_M;
  const cellH = Math.max(...ordered.map((t) => t.h)) + AUTO_GAP_M;
  const inner = (size: number) => size - 2 * AUTO_MARGIN_M + AUTO_GAP_M;
  const maxCols = Math.max(1, Math.min(ordered.length, Math.floor(inner(room.widthM) / cellW)));
  const roomShape = room.widthM / room.heightM;
  let cols = maxCols;
  let best = Infinity;
  for (let c = 1; c <= maxCols; c++) {
    const rows = Math.ceil(ordered.length / c);
    if (rows * cellH > inner(room.heightM) + 1e-9) continue;
    const off = Math.abs(Math.log((c * cellW) / (rows * cellH) / roomShape));
    if (off < best - 1e-9) {
      best = off;
      cols = c;
    }
  }
  const rows = Math.ceil(ordered.length / cols);
  const blockW = cols * cellW - AUTO_GAP_M;
  const blockH = rows * cellH - AUTO_GAP_M;
  const drawn = { widthM: round2(Math.max(room.widthM, blockW + 2 * AUTO_MARGIN_M)), heightM: round2(Math.max(room.heightM, blockH + 2 * AUTO_MARGIN_M)) };
  const x0 = (drawn.widthM - blockW) / 2;
  const y0 = (drawn.heightM - blockH) / 2;
  const places: Record<string, AutoPlace> = {};
  ordered.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    places[t.id] = {
      x: round2(x0 + col * cellW + (cellW - AUTO_GAP_M - t.w) / 2),
      y: round2(y0 + row * cellH + (cellH - AUTO_GAP_M - t.h) / 2),
      w: t.w,
      h: t.h,
      rotation: 0,
    };
  });
  return { room: drawn, places };
}

// The floor plan has been saved in the editor: its places are real.
export const planSaved = (savedAt: Date | null | undefined) => savedAt != null;
