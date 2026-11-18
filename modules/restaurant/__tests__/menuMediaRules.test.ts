// Run with: npx tsx --test modules/restaurant/__tests__/menuMediaRules.test.ts
// Part 8 Step 5: what a menu item's media uploads accept, how 360° frames are
// put in order and checked, what the files are called, and the item's menu
// details (allergens, calories, Signature).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_LIMITS,
  formatBytes,
  frameName,
  frameOrder,
  isGlb,
  isUsdz,
  modelName,
  naturalCompare,
  photoNames,
  sizeProblem,
  sniffImage,
  sniffVideo,
  spinCountProblem,
  usableType,
  videoFrameTimes,
} from "../lib/menuMediaRules";
import { menuItemSchema } from "../schemas/menuItem";
import { photoUrls, spinUrls, mediaUrl } from "../lib/publicMenu";

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("what's accepted (by the file's own bytes)", () => {
  test("photos and frames: JPG, PNG, WebP", () => {
    assert.equal(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
    assert.equal(sniffImage(bytes([0x89], "PNG", [0x0d, 0x0a])), "png");
    assert.equal(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBP")), "webp");
    assert.equal(sniffImage(bytes("GIF89a")), null);
    assert.equal(sniffImage(bytes("<svg ")), null, "no SVG (it could carry script)");
  });

  test("models: a binary glTF 2.0; a USDZ (a zip); videos: MP4/MOV, WebM", () => {
    assert.equal(isGlb(bytes("glTF", [2, 0, 0, 0])), true);
    assert.equal(isGlb(bytes("glTF", [1, 0, 0, 0])), false, "glTF 1 isn't read");
    assert.equal(isGlb(bytes('{"asset":')), false, "a .gltf (JSON) isn't a GLB");
    assert.equal(isUsdz(bytes("PK", [3, 4])), true);
    assert.equal(isUsdz(bytes("glTF")), false);
    assert.equal(sniffVideo(bytes([0, 0, 0, 0x20], "ftypisom")), "mp4");
    assert.equal(sniffVideo(bytes([0, 0, 0, 0x14], "ftypqt  ")), "mp4", "a MOV");
    assert.equal(sniffVideo(bytes([0x1a, 0x45, 0xdf, 0xa3])), "webm");
    assert.equal(sniffVideo(bytes("RIFF")), null);
  });

  test("the limits: 15 MB a model, 30 MB a video", () => {
    assert.equal(MEDIA_LIMITS.model, 15 * 1024 * 1024);
    assert.equal(MEDIA_LIMITS.usdz, 15 * 1024 * 1024);
    assert.equal(MEDIA_LIMITS.video, 30 * 1024 * 1024);
    assert.deepEqual([formatBytes(512), formatBytes(2048), formatBytes(3 * 1024 * 1024), formatBytes(2_600_000)], ["512 B", "2 KB", "3.0 MB", "2.5 MB"]);
  });
});

describe("360° frames", () => {
  test("in order by name, numbers as numbers (dish2 before dish10)", () => {
    const names = ["dish10.jpg", "dish2.jpg", "dish1.jpg", "Dish03.JPG"];
    const order = frameOrder(names);
    assert.ok(order.ok);
    assert.deepEqual(order.order.map((i) => names[i]), ["dish1.jpg", "dish2.jpg", "Dish03.JPG", "dish10.jpg"]);
    assert.ok(naturalCompare("IMG_0009", "IMG_0010") < 0);
  });

  test("the same name twice: refused (the order isn't clear)", () => {
    const order = frameOrder(["a1.jpg", "A1.JPG"]);
    assert.equal(order.ok, false);
    assert.match(order.ok ? "" : order.error, /Two frames are called “A1\.JPG”/);
  });

  test("24–36 of them, all the same size", () => {
    assert.deepEqual([spinCountProblem(24), spinCountProblem(36), spinCountProblem(30)], [null, null, null]);
    assert.match(spinCountProblem(23) ?? "", /at least 24 frames \(this has 23\)/);
    assert.match(spinCountProblem(37) ?? "", /at most 36 frames \(this has 37\)/);
    assert.equal(sizeProblem([{ name: "a", width: 800, height: 600 }, { name: "b", width: 800, height: 600 }]), null);
    assert.equal(sizeProblem([{ name: "a", width: 800, height: 600 }, { name: "b", width: 800, height: 601 }]), "The frames aren't all the same size: “a” is 800 × 600, “b” is 800 × 601.");
  });

  test("from a video: 36 frames, evenly through it", () => {
    const times = videoFrameTimes(6);
    assert.equal(times.length, 36);
    assert.deepEqual([times[0], times[35]], [0.083, 5.917]);
    assert.deepEqual(videoFrameTimes(0), []);
  });
});

describe("the files", () => {
  test("named afresh each upload (no phone shows a stale one); the menu finds them", () => {
    const names = photoNames("mwk1abcd");
    assert.deepEqual(names, { full: "photo-mwk1abcd-1200.webp", thumb: "photo-mwk1abcd-400.webp" });
    assert.deepEqual(photoUrls("cm1", `menu/cm1/${names.full}`), { full: "/menu/media/cm1/photo-mwk1abcd-1200.webp", thumb: "/menu/media/cm1/photo-mwk1abcd-400.webp" });
    const frames = Array.from({ length: 24 }, (_, i) => `menu/cm1/${frameName("mwk1abcd", i)}`);
    assert.equal(frames[7], "menu/cm1/spin-mwk1abcd-07.webp");
    assert.equal(spinUrls("cm1", frames)?.[23], "/menu/media/cm1/spin-mwk1abcd-23.webp");
    assert.equal(mediaUrl("cm1", `menu/cm1/${modelName("mwk1abcd", "glb")}`, "glb"), "/menu/media/cm1/model-mwk1abcd.glb");
    assert.equal(mediaUrl("cm1", `menu/cm1/${modelName("mwk1abcd", "usdz")}`, "usdz"), "/menu/media/cm1/model-mwk1abcd.usdz");
  });

  test("the menu shows the chosen type only while its files are there", () => {
    assert.deepEqual(
      [usableType("SPIN", { spin: true, model: false }), usableType("SPIN", { spin: false, model: true }), usableType("MODEL", { spin: true, model: false }), usableType("MODEL", { spin: false, model: true }), usableType("PHOTO", { spin: true, model: true })],
      ["SPIN", "PHOTO", "PHOTO", "MODEL", "PHOTO"],
    );
  });
});

describe("the item's menu details", () => {
  const base = { code: "MN-1", name: "Jollof", categoryId: "c1", price: "1500", description: "", stationId: "" };

  test("allergens, calories, Signature: optional (an item saved before them still saves)", () => {
    const parsed = menuItemSchema.parse(base);
    assert.deepEqual([parsed.allergens, parsed.calories, parsed.isSignature], [[], null, false]);
  });

  test("allergens: trimmed, no repeats (any case); calories a whole number up to 9999", () => {
    const parsed = menuItemSchema.parse({ ...base, allergens: [" Peanuts ", "peanuts", "Sesame"], calories: " 640 ", isSignature: true });
    assert.deepEqual([parsed.allergens, parsed.calories, parsed.isSignature], [["Peanuts", "Sesame"], 640, true], "the first spelling kept");
    for (const bad of ["12.5", "-3", "10000", "abc"]) assert.equal(menuItemSchema.safeParse({ ...base, calories: bad }).success, false, bad);
    assert.equal(menuItemSchema.safeParse({ ...base, calories: "0" }).success, true);
    assert.equal(menuItemSchema.safeParse({ ...base, allergens: ["x".repeat(41)] }).success, false);
    assert.equal(menuItemSchema.safeParse({ ...base, allergens: Array.from({ length: 21 }, (_, i) => `A${i}`) }).success, false);
    assert.equal(menuItemSchema.safeParse({ ...base, allergens: [" "] }).success, false);
  });
});
