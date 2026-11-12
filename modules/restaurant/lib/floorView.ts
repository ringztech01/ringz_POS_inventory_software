import { toPercent, type TableShape } from "./floorGeometry";

// The service view (Part 7 Step 6): the room as the floor plan editor saved
// it, drawn as large as fits the panel with its own proportions (the spare
// space either side or above and below — letterboxed), every table and
// fixture placed as a share of the room, so a layout made on a big screen
// looks the same on a 10" tablet.

export const MIN_DETAIL_PX = 64;
export const ROOM_PAD_PX = 24;

type RoomSize = { widthM: number; heightM: number };
type Placed = { x: number; y: number; w: number; h: number; rotation: number };

// The room's box in the panel (px), and pixels per metre.
export function fitRoom(room: RoomSize, panel: { w: number; h: number }, pad = ROOM_PAD_PX): { w: number; h: number; scale: number } {
  const scale = Math.max(0, Math.min((panel.w - 2 * pad) / room.widthM, (panel.h - 2 * pad) / room.heightM));
  return { w: room.widthM * scale, h: room.heightM * scale, scale };
}

// Where it goes in the room's box: percentages (the box can be any size).
export function placeIn(item: Placed, room: RoomSize): { left: string; top: string; width: string; height: string; transform?: string } {
  const p = toPercent(item, room);
  return { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%`, ...(item.rotation ? { transform: `rotate(${item.rotation}deg)` } : {}) };
}

// How wide it looks on screen (px): its width, or its depth when it's turned
// on its side — the number stays upright, so that's the room it has.
export function shownWidth(item: Placed, scale: number): number {
  const turn = ((item.rotation % 180) + 180) % 180;
  if (turn === 90) return item.h * scale;
  if (turn === 45 || turn === 135) return Math.min(item.w, item.h) * scale;
  return item.w * scale;
}

// Under 64 px wide on screen: the number only (no seats, waiter, total).
export const showsDetail = (widthPx: number) => widthPx >= MIN_DETAIL_PX;

// The number's size: up to 24 px, down to 12 on a small table.
export const nameSize = (widthPx: number) => Math.max(12, Math.min(24, Math.round(widthPx * 0.26)));

export function tableRadius(shape: TableShape, widthPx: number): string {
  if (shape === "ROUND") return "50%";
  if (shape === "BOOTH") {
    const r = Math.round(Math.min(18, widthPx * 0.16));
    return `${r}px ${r}px 4px 4px`;
  }
  return `${Math.round(Math.min(6, widthPx * 0.06))}px`;
}
