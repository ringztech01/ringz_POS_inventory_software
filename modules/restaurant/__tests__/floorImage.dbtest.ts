// The floor plan image (Part 7 Step 3) against a real database and disk:
// uploaded and re-encoded to WebP (≤ 2400 px) under uploads/floor/<areaId>/,
// replaced (the old file goes), calibrated and faded, removed — each written
// to the audit log; saved as uploaded when sharp can't load; refused (and
// nothing stored) when it isn't a PNG/JPG/WebP, is too big, or can't be read.
// Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/floorImage.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getFloorEditor } from "../server/queries/floorPlan";
import { adjustFloorImage, readFloorImage, removeFloorImage, storeFloorImage, UPLOADS_ROOT } from "../server/services/floorImage";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let areaId = "";
let userId = "";
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const dir = () => path.join(UPLOADS_ROOT, "floor", areaId);
const files = () => (existsSync(dir()) ? readdirSync(dir()).sort() : []);
const audits = () => prisma.auditLog.findMany({ where: { entityType: "DiningArea", entityId: areaId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const areaRow = () => prisma.diningArea.findUniqueOrThrow({ where: { id: areaId }, select: { backgroundImage: true, backgroundOpacity: true, backgroundScale: true, backgroundOffset: true } });
// Read the stored file into memory before sharp looks at it: sharp given a
// path keeps the file open on Windows, and then it can't be replaced.
const stored = async (file: string) => sharp(readFileSync(path.join(UPLOADS_ROOT, file))).metadata();
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).png().toBuffer();
const upload = (name: string, type: string, bytes: Buffer, load?: Parameters<typeof storeFloorImage>[1]) => storeFloorImage({ areaId, userId, file: { name, type, size: bytes.length, bytes } }, load);

describe("Floor plan image (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: `Image ${stamp}`, warehouseId }, select: { id: true } })).id;
    userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  });
  after(async () => {
    await rm(dir(), { recursive: true, force: true });
    await prisma.$disconnect();
  });

  test("upload: re-encoded to WebP no larger than 2400 px, stored under uploads/floor/<areaId>/, logged", async () => {
    const result = await upload("Main Hall sketch.png", "image/png", await png(3000, 1200));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.replaced, false);
    const row = await areaRow();
    assert.match(row.backgroundImage ?? "", new RegExp(`^floor/${areaId}/\\d+-main-hall-sketch\\.webp$`));
    assert.deepEqual(files(), [path.basename(row.backgroundImage!)]);
    const meta = await stored(row.backgroundImage!);
    assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 2400, 960]);
    assert.deepEqual([Number(row.backgroundOpacity), row.backgroundScale, row.backgroundOffset], [0.35, null, null]);

    const [entry] = await audits();
    assert.equal(entry.action, "floor.background.upload");
    assert.equal(entry.userId, userId);
    assert.equal(entry.businessId, "default");
    assert.deepEqual(
      (({ file, original, width, height, reencoded }) => ({ file, original, width, height, reencoded }))(entry.meta as Record<string, unknown>),
      { file: row.backgroundImage, original: "Main Hall sketch.png", width: 2400, height: 960, reencoded: true },
    );

    const editor = (await getFloorEditor()).find((a) => a.id === areaId)!;
    assert.equal(editor.background?.name, "main-hall-sketch.webp");
    assert.equal(editor.background?.url, `/restaurant/settings/floor/image/${areaId}?v=${encodeURIComponent(path.basename(row.backgroundImage!))}`);
    const served = await readFloorImage(areaId);
    assert.equal(served?.contentType, "image/webp");
    assert.ok(served && served.bytes.equals(readFileSync(path.join(UPLOADS_ROOT, row.backgroundImage!))));
  });

  test("a small image isn't enlarged", async () => {
    const result = await upload("small.png", "image/png", await png(800, 500));
    assert.ok(result.ok);
    const meta = await stored((await areaRow()).backgroundImage!);
    assert.deepEqual([meta.width, meta.height], [800, 500]);
  });

  test("fade and calibrate: saved and logged (from → to); a calibration can be cleared", async () => {
    const faded = await adjustFloorImage({ areaId, userId, opacity: 0.6 });
    assert.ok(faded.ok && faded.background.opacity === 0.6);
    const calibrated = await adjustFloorImage({ areaId, userId, calibration: { scale: 123.4567, offset: { x: -0.5, y: 1.25 } } });
    assert.ok(calibrated.ok);
    assert.deepEqual(calibrated.background.calibration, { scale: 123.4567, offset: { x: -0.5, y: 1.25 } });
    const row = await areaRow();
    assert.deepEqual([Number(row.backgroundScale), row.backgroundOffset], [123.4567, { x: -0.5, y: 1.25 }]);

    const log = await audits();
    const opacity = log.find((e) => e.action === "floor.background.opacity")!;
    assert.deepEqual((opacity.meta as { opacity: unknown }).opacity, { from: 0.35, to: 0.6 });
    const calibrate = log.find((e) => e.action === "floor.background.calibrate")!;
    assert.deepEqual((calibrate.meta as { calibration: unknown }).calibration, { from: null, to: { scale: 123.4567, offset: { x: -0.5, y: 1.25 } } });

    const cleared = await adjustFloorImage({ areaId, userId, calibration: null });
    assert.ok(cleared.ok && cleared.background.calibration === null);
    assert.equal((await audits()).at(-1)?.action, "floor.background.uncalibrate");
  });

  test("replace: the new image in, the old file gone, the calibration cleared, the opacity kept", async () => {
    await adjustFloorImage({ areaId, userId, calibration: { scale: 50, offset: { x: 0, y: 0 } } });
    const old = (await areaRow()).backgroundImage!;
    const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#ccddee" } }).jpeg().toBuffer();
    const result = await upload("photo.jpg", "image/jpeg", jpeg);
    assert.ok(result.ok && result.replaced);
    const row = await areaRow();
    assert.notEqual(row.backgroundImage, old);
    assert.deepEqual(files(), [path.basename(row.backgroundImage!)], "only the new file is left");
    assert.deepEqual([Number(row.backgroundOpacity), row.backgroundScale, row.backgroundOffset], [0.6, null, null]);
    const entry = (await audits()).at(-1)!;
    assert.equal(entry.action, "floor.background.replace");
    assert.equal((entry.meta as { previous: string }).previous, old);
  });

  test("sharp can't load: the original is kept (its type and size checked), and the upload still works", async () => {
    const original = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const result = await upload("scan.jpeg", "image/jpeg", original, async () => null);
    assert.ok(result.ok, JSON.stringify(result));
    const row = await areaRow();
    assert.match(row.backgroundImage ?? "", /-scan\.jpg$/);
    assert.ok(readFileSync(path.join(UPLOADS_ROOT, row.backgroundImage!)).equals(original), "the bytes as uploaded");
    assert.equal(((await audits()).at(-1)!.meta as { reencoded: boolean }).reencoded, false);
    assert.equal((await readFloorImage(areaId))?.contentType, "image/jpeg");
  });

  test("refused, with nothing stored or logged: not PNG/JPG/WebP (whatever it claims), too big, empty, unreadable, a deleted area", async () => {
    const start = { files: files(), row: await areaRow(), log: (await audits()).length };
    const realPng = await png(10, 10);
    const cases: [string, Promise<{ ok: boolean; error?: string }>][] = [
      ["Use a PNG, JPG or WebP image.", upload("plan.gif", "image/gif", Buffer.from("GIF89a" + "x".repeat(50)))],
      ["Use a PNG, JPG or WebP image.", upload("plan.png", "image/png", Buffer.from("GIF89a" + "x".repeat(50)))],
      ["Use a PNG, JPG or WebP image.", upload("plan.png", "image/gif", realPng)],
      ["The image must be 8 MB or smaller.", upload("huge.png", "image/png", Buffer.concat([realPng, Buffer.alloc(8 * 1024 * 1024)]))],
      ["That file is empty.", upload("empty.png", "image/png", Buffer.alloc(0))],
      ["That image couldn't be read. Try saving it again as a PNG or JPG.", upload("broken.png", "image/png", Buffer.concat([realPng.subarray(0, 16), Buffer.alloc(200)]))],
    ];
    for (const [message, attempt] of cases) {
      const result = await attempt;
      assert.ok(!result.ok, JSON.stringify(result));
      assert.equal(result.error, message);
    }
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const gone = await prisma.diningArea.create({ data: { name: `Gone ${stamp}`, warehouseId, deletedAt: new Date() }, select: { id: true } });
    const deleted = await storeFloorImage({ areaId: gone.id, userId, file: { name: "a.png", type: "image/png", size: realPng.length, bytes: realPng } });
    assert.ok(!deleted.ok && /deleted/.test(deleted.error));
    assert.equal(existsSync(path.join(UPLOADS_ROOT, "floor", gone.id)), false);
    assert.deepEqual({ files: files(), row: await areaRow(), log: (await audits()).length }, start);
  });

  test("the image route only reads inside uploads/floor", async () => {
    const keep = (await areaRow()).backgroundImage;
    await prisma.diningArea.update({ where: { id: areaId }, data: { backgroundImage: "floor/../../package.json" } });
    assert.equal(await readFloorImage(areaId), null);
    await prisma.diningArea.update({ where: { id: areaId }, data: { backgroundImage: keep } });
  });

  test("remove: the image and its file gone, logged; again: nothing to remove; adjusting without one is refused", async () => {
    const file = (await areaRow()).backgroundImage!;
    const removed = await removeFloorImage({ areaId, userId });
    assert.ok(removed.ok);
    const row = await areaRow();
    assert.deepEqual([row.backgroundImage, row.backgroundScale, row.backgroundOffset], [null, null, null]);
    assert.deepEqual(files(), []);
    const entry = (await audits()).at(-1)!;
    assert.deepEqual([entry.action, (entry.meta as { file: string }).file], ["floor.background.remove", file]);
    assert.equal(await readFloorImage(areaId), null);

    const again = await removeFloorImage({ areaId, userId });
    assert.ok(!again.ok && again.error === "There's no floor plan image to remove.");
    const adjust = await adjustFloorImage({ areaId, userId, opacity: 0.5 });
    assert.ok(!adjust.ok && adjust.error === "Upload a floor plan image first.");
  });
});
