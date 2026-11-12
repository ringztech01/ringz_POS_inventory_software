// The floor plan image (Part 7 Step 3): the rules the browser and the server
// share, and the maths that lays the image under the room.
//
// An uploaded image is drawn "contain" (as large as fits, centred) until it's
// calibrated. Calibrating — two points tapped on the image and the real
// distance between them — gives its scale (image pixels per real metre) and
// its offset (where its top-left corner sits in the room, metres), so it's
// drawn true to size from then on.

export const FLOOR_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
// Re-encoded to WebP no larger than this on its long side.
export const FLOOR_IMAGE_MAX_PX = 2400;
export const FLOOR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const FLOOR_IMAGE_ACCEPT = FLOOR_IMAGE_TYPES.join(",");
export const OPACITY_LIMITS = { min: 0.1, max: 0.9 } as const;

export type FloorImageKind = "png" | "jpeg" | "webp";
export const EXTENSION: Record<FloorImageKind, string> = { png: "png", jpeg: "jpg", webp: "webp" };
export const CONTENT_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// What the file really is, from its first bytes (not its name or the type the
// browser claims): PNG, JPEG or WebP, or null.
export function sniffImage(bytes: Uint8Array): FloorImageKind | null {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  // "RIFF" …size… "WEBP"
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

// Checked before anything is stored (and in the browser before it's sent).
export function floorImageProblem(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (file.size > FLOOR_IMAGE_MAX_BYTES) return "The image must be 8 MB or smaller.";
  if (file.type && !(FLOOR_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPG or WebP image.";
  return null;
}

// A stored file's name for people: "1762770000000-main-hall-sketch.webp" →
// "main-hall-sketch.webp".
export function floorImageName(stored: string): string {
  const base = stored.split("/").pop() ?? stored;
  const dash = base.indexOf("-");
  return dash > 0 && /^\d+$/.test(base.slice(0, dash)) ? base.slice(dash + 1) : base;
}

// "Main Hall sketch (1).PNG" → "main-hall-sketch-1".
export function fileSlug(name: string): string {
  const stem = name.replace(/\.[^.]*$/, "");
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "floor-plan"
  );
}

export type Point = { x: number; y: number };
export type Calibration = { scale: number; offset: Point };
type Size = { w: number; h: number };
type RoomSize = { widthM: number; heightM: number };

// Where the image sits in the room, in metres: true to size once
// calibrated; until then as large as fits, centred.
export function imageBox(room: RoomSize, natural: Size, calibration: Calibration | null): { x: number; y: number; w: number; h: number } {
  if (calibration && calibration.scale > 0) {
    return { x: calibration.offset.x, y: calibration.offset.y, w: natural.w / calibration.scale, h: natural.h / calibration.scale };
  }
  const metresPerPx = Math.min(room.widthM / natural.w, room.heightM / natural.h);
  const w = natural.w * metresPerPx;
  const h = natural.h * metresPerPx;
  return { x: (room.widthM - w) / 2, y: (room.heightM - h) / 2, w, h };
}

// Two points tapped on the image as it's drawn now (room metres) and the
// real distance between them → its scale, and an offset that keeps the
// first point exactly where it was. Null if the points are the same spot or
// the distance isn't a positive number.
export function calibrate(box: { x: number; y: number; w: number }, natural: Size, a: Point, b: Point, realM: number): Calibration | null {
  const tapped = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(tapped > 0.01) || !(realM > 0) || !(box.w > 0)) return null;
  const pxPerDrawnM = natural.w / box.w;
  const scale = (tapped * pxPerDrawnM) / realM;
  const aPx = { x: (a.x - box.x) * pxPerDrawnM, y: (a.y - box.y) * pxPerDrawnM };
  const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
  return { scale: round(scale, 4), offset: { x: round(a.x - aPx.x / scale, 4), y: round(a.y - aPx.y / scale, 4) } };
}
