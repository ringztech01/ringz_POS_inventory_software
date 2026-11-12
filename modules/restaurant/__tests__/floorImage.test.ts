// Run with: npx tsx --test modules/restaurant/__tests__/floorImage.test.ts
// The floor plan image (Part 7 Step 3), without a database: what counts as
// an image, how it's laid under the room, calibrating it, and the room-size
// and image inputs the actions accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, fileSlug, floorImageName, floorImageProblem, imageBox, sniffImage } from "../lib/floorImage";
import { floorImageAdjustSchema, floorRoomSchema } from "../schemas/floorPlan";

const bytes = (...values: number[]) => new Uint8Array(values);

test("an image is what its bytes say: PNG, JPEG or WebP — not its name or claimed type", () => {
  assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), "png");
  assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0)), "jpeg");
  assert.equal(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a……")), null, "GIF");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns=…")), null, "SVG");
  assert.equal(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20)), null, "a RIFF that isn't WebP (AVI)");
});

test("checked before upload: 8 MB at most, PNG/JPG/WebP, not empty", () => {
  assert.equal(floorImageProblem({ size: 8 * 1024 * 1024, type: "image/png" }), null);
  assert.equal(floorImageProblem({ size: 8 * 1024 * 1024 + 1, type: "image/png" }), "The image must be 8 MB or smaller.");
  assert.equal(floorImageProblem({ size: 100, type: "image/gif" }), "Use a PNG, JPG or WebP image.");
  assert.equal(floorImageProblem({ size: 100, type: "" }), null, "no type from the browser: the bytes decide");
  assert.equal(floorImageProblem({ size: 0, type: "image/png" }), "That file is empty.");
});

test("file names: stored with a time stamp and a tidy slug, shown without the stamp", () => {
  assert.equal(fileSlug("Main Hall sketch (1).PNG"), "main-hall-sketch-1");
  assert.equal(fileSlug("....png"), "floor-plan");
  assert.equal(floorImageName("floor/abc/1762770000000-main-hall-sketch.webp"), "main-hall-sketch.webp");
  assert.equal(floorImageName("floor/abc/plan.webp"), "plan.webp");
});

const ROOM = { widthM: 12, heightM: 8 };

test("not calibrated: the image is drawn as large as fits the room, centred", () => {
  // 2400 × 800 (3:1) in a 12 × 8 m room: full width, 4 m deep, 2 m from the top.
  assert.deepEqual(imageBox(ROOM, { w: 2400, h: 800 }, null), { x: 0, y: 2, w: 12, h: 4 });
  // 1000 × 1000 square: full depth, 2 m in from each side.
  assert.deepEqual(imageBox(ROOM, { w: 1000, h: 1000 }, null), { x: 2, y: 0, w: 8, h: 8 });
});

test("calibrated: true to size — its pixels ÷ its scale — at its offset", () => {
  assert.deepEqual(imageBox(ROOM, { w: 2400, h: 1600 }, { scale: 100, offset: { x: -1, y: 0.5 } }), { x: -1, y: 0.5, w: 24, h: 16 });
});

test("calibrate: two points and the real distance give the scale; the first point stays where it was", () => {
  const natural = { w: 2400, h: 800 };
  const box = imageBox(ROOM, natural, null); // 200 image px per drawn metre
  // Tapped 6 m apart as drawn (1200 image px), really 4 m apart: 300 px per real metre.
  const a = { x: 3, y: 4 };
  const b = { x: 9, y: 4 };
  const result = calibrate(box, natural, a, b, 4);
  assert.ok(result);
  assert.equal(result.scale, 300);
  // Drawn with the new scale: the first point is still at (3, 4) and the
  // second is now exactly 4 m from it.
  const drawn = imageBox(ROOM, natural, result);
  const pxOf = (p: { x: number; y: number }) => ({ x: (p.x - box.x) * 200, y: (p.y - box.y) * 200 });
  const at = (p: { x: number; y: number }) => ({ x: drawn.x + pxOf(p).x / result.scale, y: drawn.y + pxOf(p).y / result.scale });
  // (The offset is kept to 0.1 mm.)
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < 1e-3 && Math.abs(p.y - q.y) < 1e-3;
  assert.ok(near(at(a), a), JSON.stringify(at(a)));
  assert.ok(Math.abs(Math.hypot(at(b).x - at(a).x, at(b).y - at(a).y) - 4) < 1e-3);
});

test("calibrate: the same spot twice, or no distance, gives nothing", () => {
  const box = { x: 0, y: 0, w: 12 };
  assert.equal(calibrate(box, { w: 1200, h: 800 }, { x: 1, y: 1 }, { x: 1, y: 1 }, 3), null);
  assert.equal(calibrate(box, { w: 1200, h: 800 }, { x: 1, y: 1 }, { x: 4, y: 1 }, 0), null);
});

test("room size: 2–100 m each way in steps of 10 cm; the grid is 0.25, 0.5 or 1 m", () => {
  assert.ok(floorRoomSchema.safeParse({ widthM: 14.5, heightM: 9, gridM: 0.25 }).success);
  const refused = (room: object) => floorRoomSchema.safeParse(room).error?.issues[0]?.message;
  assert.equal(refused({ widthM: 12.05, heightM: 8, gridM: 0.5 }), "Room sizes go in steps of 10 cm.");
  assert.equal(refused({ widthM: 1.5, heightM: 8, gridM: 0.5 }), "A room is at least 2 m each way.");
  assert.equal(refused({ widthM: 12, heightM: 101, gridM: 0.5 }), "A room is at most 100 m each way.");
  assert.equal(refused({ widthM: 12, heightM: 8, gridM: 0.3 }), "The grid is 0.25, 0.5, 1 m.");
});

test("image adjustments: opacity 10–90 %, a calibration or null to clear it — and something to change", () => {
  const ok = (input: object) => floorImageAdjustSchema.safeParse(input).success;
  assert.ok(ok({ areaId: "a", opacity: 0.6 }));
  assert.ok(ok({ areaId: "a", calibration: { scale: 120.5, offset: { x: -0.4, y: 1 } } }));
  assert.ok(ok({ areaId: "a", calibration: null }));
  assert.ok(!ok({ areaId: "a", opacity: 0.95 }));
  assert.ok(!ok({ areaId: "a", calibration: { scale: 0, offset: { x: 0, y: 0 } } }));
  assert.ok(!ok({ areaId: "a" }), "nothing to change");
});
