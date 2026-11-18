// A menu item's media (Part 8 Step 5), pure: what's accepted, how frames are
// put in order and checked, and what the files are called. The server's
// services (server/services/menuMedia.ts) do the work.

const MB = 1024 * 1024;
export const MEDIA_LIMITS = {
  photo: 15 * MB,
  frame: 15 * MB,
  video: 30 * MB,
  model: 15 * MB,
  usdz: 15 * MB,
} as const;
// What a compressed 3D model should come in under.
export const MODEL_TARGET_BYTES = 3 * MB;
export const SPIN_MIN = 24;
export const SPIN_MAX = 36;
// Frames taken from a video: evenly through it.
export const VIDEO_FRAMES = 36;
// Pixel sizes kept: the photo and its thumbnail; a 360° frame.
export const PHOTO_PX = 1200;
export const THUMB_PX = 400;
export const FRAME_PX = 1000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

const startsWith = (bytes: Uint8Array, ascii: string, at = 0) => [...ascii].every((c, i) => bytes[at + i] === c.charCodeAt(0));

// What a file really is, by its first bytes (never its name or the browser's word).
export function sniffImage(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && startsWith(bytes, "PNG", 1)) return "png";
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) return "webp";
  return null;
}
// A binary glTF (version 2).
export const isGlb = (bytes: Uint8Array) => startsWith(bytes, "glTF") && bytes[4] === 2 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0;
// A USDZ is a zip.
export const isUsdz = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
// MP4 / MOV (an "ftyp" box) or WebM (EBML).
export function sniffVideo(bytes: Uint8Array): "mp4" | "webm" | null {
  if (startsWith(bytes, "ftyp", 4)) return "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return null;
}

// "frame2" before "frame10": numbers compared as numbers.
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

// The frames' order: by their file names, numbered as a camera or turntable
// app names them. Refused: the same name twice (which comes first?).
export function frameOrder(names: readonly string[]): { ok: true; order: number[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Two frames are called “${name}”: the order isn't clear. Rename one and try again.` };
    seen.add(key);
  }
  const order = names.map((_, i) => i).sort((a, b) => naturalCompare(names[a], names[b]));
  return { ok: true, order };
}

export function spinCountProblem(count: number): string | null {
  if (count < SPIN_MIN) return `A 360° needs at least ${SPIN_MIN} frames (this has ${count}).`;
  if (count > SPIN_MAX) return `A 360° takes at most ${SPIN_MAX} frames (this has ${count}).`;
  return null;
}

// Every frame the same width and height, or the spin would jump.
export function sizeProblem(frames: readonly { name: string; width: number; height: number }[]): string | null {
  const first = frames[0];
  if (!first) return null;
  const odd = frames.find((f) => f.width !== first.width || f.height !== first.height);
  return odd ? `The frames aren't all the same size: “${first.name}” is ${first.width} × ${first.height}, “${odd.name}” is ${odd.width} × ${odd.height}.` : null;
}

// Where in a video the frames are taken: evenly, the middle of each slice.
export function videoFrameTimes(seconds: number, count = VIDEO_FRAMES): number[] {
  if (!(seconds > 0)) return [];
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) * seconds * 1000) / count) / 1000);
}

// Files are named afresh on every upload (a phone may still have the old
// one cached): photo-<stamp>-1200.webp (and -400), spin-<stamp>-07.webp,
// model-<stamp>.glb / .usdz.
export const photoNames = (stamp: string) => ({ full: `photo-${stamp}-${PHOTO_PX}.webp`, thumb: `photo-${stamp}-${THUMB_PX}.webp` });
export const frameName = (stamp: string, index: number) => `spin-${stamp}-${String(index).padStart(2, "0")}.webp`;
export const modelName = (stamp: string, kind: "glb" | "usdz") => `model-${stamp}.${kind}`;
export const STAMP = /^[a-z0-9]{6,20}$/;
// A staged 360° upload's id.
export const SESSION = /^[a-f0-9]{16}$/;

export type MenuMediaKind = "photo" | "spin" | "model" | "usdz";
export type MenuMediaType = "PHOTO" | "SPIN" | "MODEL";

// The type the menu shows must have its files; otherwise it's the photo.
export function usableType(chosen: MenuMediaType, has: { spin: boolean; model: boolean }): MenuMediaType {
  if (chosen === "SPIN" && !has.spin) return "PHOTO";
  if (chosen === "MODEL" && !has.model) return "PHOTO";
  return chosen;
}
