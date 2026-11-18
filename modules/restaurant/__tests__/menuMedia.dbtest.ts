// Part 8 Step 5 against a real database (a throwaway copy) and the real
// uploads/menu folder (this test's own items' folders, removed after): a menu
// item's media as Food › Menu items saves it.
//   - photo: WebP at 1200 px and 400 px; a new one replaces the old files;
//   - 360° from images: in name order, 24–36, all one size — or refused with
//     nothing published; from a short video (ffmpeg): 36 frames;
//   - 3D: a GLB compressed (Meshopt, WebP textures) and smaller; one that
//     can't be compressed kept as it came, with a note; over 15 MB or not a
//     GLB refused; a USDZ only with a GLB;
//   - the type the menu shows needs its files; removing them falls back to
//     the photo; every change logged; the guest menu gets the new media;
//   - the item's menu details (allergens, calories, Signature) saved;
//   - module off: the upload and preview routes answer 404.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/menuMedia.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { prisma } from "@/lib/db";
import { menuItemSchema } from "../schemas/menuItem";
import { updateMenuItem } from "../server/services/menuItems";
import { addSpinFrame, finishSpin, getMenuMedia, hasFfmpeg, removeMenuMedia, saveMenuModel, saveMenuPhoto, saveMenuUsdz, setMenuMediaType, spinFromVideo, startSpin } from "../server/services/menuMedia";
import { menuMedia, photoUrls } from "../lib/publicMenu";
import { GET as filePreview } from "../server/routes/menuMediaFile";
import { POST as upload } from "../server/routes/menuMediaUpload";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

const MENU_DIR = path.join(process.cwd(), "uploads", "menu");
const ids: string[] = [];
let itemId = "";
let categoryId = "";
let userId = "";
let menuDirExisted = true;
let work = "";

const dirOf = (id: string) => path.join(MENU_DIR, id);
const files = async (id: string) => (await readdir(dirOf(id)).catch(() => [])).sort();
const item = (id = itemId) => prisma.product.findUniqueOrThrow({ where: { id }, select: { photoPath: true, spinFrames: true, modelGlbPath: true, modelUsdzPath: true, mediaType: true } });
const asFile = (bytes: Buffer, name = "upload") => ({ name, size: bytes.length, bytes });
const png = (w: number, h: number, r: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 40, b: 90 } } }).png().toBuffer();

// A GLB with work to do: a dense grid and a 2048 px texture.
async function heavyGlb(): Promise<Buffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = 120;
  const positions = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) positions.set([x / n, Math.sin(x / 7) * Math.cos(y / 9) * 0.1, y / n], (y * n + x) * 3);
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const a = y * n + x;
      indices.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], k);
      k += 6;
    }
  const uvs = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) uvs.set([positions[i * 3], positions[i * 3 + 2]], i * 2);
  const texture = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="2048" height="2048" fill="url(#g)"/><circle cx="1024" cy="1024" r="700" fill="#ff0" opacity=".5"/></svg>`) }])
    .png({ compressionLevel: 1 })
    .toBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(uvs).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer))
    .setMaterial(doc.createMaterial().setBaseColorTexture(doc.createTexture().setImage(new Uint8Array(texture)).setMimeType("image/png")));
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

describe("A menu item's media (database copy)", { skip }, () => {
  let moduleWas = true;
  before(async () => {
    moduleWas = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true } });
    menuDirExisted = await stat(MENU_DIR).then(() => true, () => false);
    work = await mkdtemp(path.join(tmpdir(), "menu-media-"));
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } });
    userId = admin.id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    categoryId = (await prisma.category.create({ data: { name: "Media check" }, select: { id: true } })).id;
    itemId = (await prisma.product.create({ data: { name: "MM Grilled Fish", code: `MM-${Date.now()}`, price: "4000", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", showOnMenu: true }, select: { id: true } })).id;
    ids.push(itemId);
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: moduleWas } });
    for (const id of ids) await rm(dirOf(id), { recursive: true, force: true });
    if (!menuDirExisted) await rmdir(MENU_DIR).catch(() => undefined);
    if (work) await rm(work, { recursive: true, force: true });
  });

  test("photo: WebP at 1200 px and its 400 px thumbnail; a new one replaces the old files", async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 90, b: 30 } } }).jpeg().toBuffer();
    const saved = await saveMenuPhoto(itemId, userId, asFile(jpeg));
    assert.ok(saved.ok, JSON.stringify(saved));
    const first = (await item()).photoPath!;
    assert.match(first, new RegExp(`^menu/${itemId}/photo-[a-z0-9]+-1200\\.webp$`));
    // Read into memory first: sharp keeps a file it opened by path locked on Windows.
    const full = await sharp(await readFile(path.join(process.cwd(), "uploads", first))).metadata();
    const thumb = await sharp(await readFile(path.join(process.cwd(), "uploads", first.replace("-1200.", "-400.")))).metadata();
    assert.deepEqual([full.format, full.width, full.height, thumb.width, thumb.height], ["webp", 1200, 800, 400, 267]);
    assert.ok(saved.ok && saved.media.photo?.thumb.endsWith("-400.webp"));
    await saveMenuPhoto(itemId, userId, asFile(await png(800, 600, 20)));
    const second = (await item()).photoPath!;
    assert.notEqual(second, first);
    assert.deepEqual((await files(itemId)).filter((f) => f.startsWith("photo-")).length, 2, "only the new pair left");
    assert.deepEqual(photoUrls(itemId, second)?.full, `/menu/media/${itemId}/${second.split("/").pop()}`);
    for (const bad of [Buffer.from("GIF89a....."), Buffer.from("<svg xmlns='x'/>")]) assert.deepEqual(await saveMenuPhoto(itemId, userId, asFile(bad)), { ok: false, error: "Use a JPG, PNG or WebP photo." });
  });

  test("360° from images: published in name order (shuffled when sent)", async () => {
    const started = await startSpin(itemId);
    assert.ok(started.ok);
    const order = Array.from({ length: 24 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    for (const n of order) {
      const added = await addSpinFrame(itemId, started.session, asFile(await png(640, 480, n * 10), `frame${n}.png`));
      assert.ok(added.ok, JSON.stringify(added));
    }
    const done = await finishSpin(itemId, started.session, userId);
    assert.ok(done.ok, JSON.stringify(done));
    const frames = (await item()).spinFrames as string[];
    assert.equal(frames.length, 24);
    const reds: number[] = [];
    for (const f of frames) reds.push((await sharp(await readFile(path.join(process.cwd(), "uploads", f))).raw().toBuffer())[0]);
    assert.ok(reds.every((r, i) => i === 0 || r > reds[i - 1]), `frame1 … frame24 in order: ${reds.join(",")}`);
    assert.ok(!(await files(itemId)).some((f) => f.startsWith(".spin-")), "the staging folder is gone");
  });

  test("360° refused, with nothing published: too few; not one size; the same name twice", async () => {
    const before = (await item()).spinFrames;
    const attempt = async (frames: { name: string; w: number; h: number }[]) => {
      const s = await startSpin(itemId);
      assert.ok(s.ok);
      for (const f of frames) await addSpinFrame(itemId, s.session, asFile(await png(f.w, f.h, 50), f.name));
      return finishSpin(itemId, s.session, userId);
    };
    const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i + 1}.png`, w: 640, h: 480 }));
    assert.deepEqual(await attempt(frames(23)), { ok: false, error: "A 360° needs at least 24 frames (this has 23)." });
    const odd = frames(24);
    odd[5] = { name: "f6.png", w: 640, h: 482 };
    assert.deepEqual(await attempt(odd), { ok: false, error: "The frames aren't all the same size: “f1.png” is 640 × 480, “f6.png” is 640 × 482." });
    const twice = frames(24);
    twice[3] = { name: "F1.PNG", w: 640, h: 480 };
    const dup = await attempt(twice);
    assert.equal(dup.ok, false);
    assert.deepEqual((await item()).spinFrames, before, "the 360° that was there stays");
    assert.ok(!(await files(itemId)).some((f) => f.startsWith(".spin-")));
    assert.deepEqual(await addSpinFrame(itemId, "0123456789abcdef", asFile(await png(10, 10, 1), "x.png")), { ok: false, error: "That upload has expired. Start the 360° again." });
  });

  test("360° from a short video (ffmpeg): 36 frames", async (t) => {
    if (!(await hasFfmpeg())) return t.skip("ffmpeg isn't installed on this machine");
    const video = path.join(work, "turn.mp4");
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=640x480:rate=30", "-pix_fmt", "yuv420p", video], { windowsHide: true });
    const bytes = await readFile(video);
    const made = await spinFromVideo(itemId, userId, asFile(bytes, "turn.mp4"));
    assert.ok(made.ok, JSON.stringify(made));
    const frames = (await item()).spinFrames as string[];
    assert.equal(frames.length, 36);
    assert.equal((await files(itemId)).filter((f) => f.startsWith("spin-")).length, 36, "the images' frames replaced");
    assert.deepEqual(await spinFromVideo(itemId, userId, asFile(Buffer.from("not a video at all"), "x.mp4")), { ok: false, error: "Use an MP4, MOV or WebM video." });
  });

  test("3D: the GLB compressed and smaller (size shown); USDZ only with a GLB", async () => {
    const bare = (await prisma.product.create({ data: { name: "MM Bare", code: `MMB-${Date.now()}`, price: "1", categoryId, brandId: (await prisma.brand.findFirstOrThrow({ select: { id: true } })).id, unitId: (await prisma.unit.findFirstOrThrow({ select: { id: true } })).id, taxType: "EXCLUSIVE", productType: "MENU_ITEM" }, select: { id: true } })).id;
    ids.push(bare);
    assert.deepEqual(await saveMenuUsdz(bare, userId, asFile(Buffer.from("PK\u0003\u0004usdz"))), { ok: false, error: "Add the GLB model first; the USDZ goes with it." });
    const glb = await heavyGlb();
    const saved = await saveMenuModel(itemId, userId, asFile(glb, "fish.glb"));
    assert.ok(saved.ok, JSON.stringify(saved));
    const stored = (await item()).modelGlbPath!;
    const size = (await stat(path.join(process.cwd(), "uploads", stored))).size;
    assert.ok(size < glb.length, `smaller: ${glb.length} → ${size}`);
    assert.ok(saved.ok && saved.media.model?.size === size);
    assert.match(saved.ok ? (saved.notice ?? "") : "", /^Compressed from .* to .*\./);
    const written = await new NodeIO().registerExtensions((await import("@gltf-transform/extensions")).ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": (await import("meshoptimizer")).MeshoptDecoder }).readBinary(new Uint8Array(await readFile(path.join(process.cwd(), "uploads", stored))));
    const used = written.getRoot().listExtensionsUsed().map((e) => e.extensionName);
    assert.ok(used.includes("EXT_meshopt_compression") && used.includes("EXT_texture_webp"), used.join(","));
    assert.ok((await saveMenuUsdz(itemId, userId, asFile(Buffer.from("PK\u0003\u0004usdz")))).ok);
  });

  test("3D refused: not a GLB, over 15 MB; one that can't be compressed is kept as it came, with a note", async () => {
    assert.deepEqual(await saveMenuModel(itemId, userId, asFile(Buffer.from('{"asset":{"version":"2.0"}}'))), { ok: false, error: "Use a GLB file (binary glTF 2.0)." });
    const huge = { name: "big.glb", size: 16 * 1024 * 1024, bytes: Buffer.from("glTF\u0002\u0000\u0000\u0000") };
    assert.deepEqual(await saveMenuModel(itemId, userId, huge), { ok: false, error: "That model is 16.0 MB; 15.0 MB at most." });
    const broken = Buffer.concat([Buffer.from("glTF\u0002\u0000\u0000\u0000"), Buffer.alloc(64, 7)]);
    const kept = await saveMenuModel(itemId, userId, asFile(broken, "broken.glb"));
    assert.ok(kept.ok, JSON.stringify(kept));
    assert.equal(kept.ok && kept.notice, "This model couldn't be compressed here, so the original is kept.");
    assert.deepEqual(await readFile(path.join(process.cwd(), "uploads", (await item()).modelGlbPath!)), broken);
  });

  test("the type the menu shows: only with its files; removing them falls back to the photo; the guest menu follows", async () => {
    assert.ok((await setMenuMediaType(itemId, "MODEL", userId)).ok);
    let row = await item();
    assert.equal(row.mediaType, "MODEL");
    assert.ok(menuMedia(itemId, row).modelFiles?.glb.endsWith(".glb"));
    assert.ok((await setMenuMediaType(itemId, "SPIN", userId)).ok);
    assert.equal(menuMedia(itemId, await item()).spinFrames?.length, 36);
    const model = (await item()).modelGlbPath;
    assert.ok((await removeMenuMedia(itemId, "model", userId)).ok);
    row = await item();
    assert.deepEqual([row.mediaType, row.modelGlbPath, row.modelUsdzPath], ["SPIN", null, null], "the spin stays the choice");
    assert.ok(!(await files(itemId)).includes(model!.split("/").pop()!), "its files are gone");
    assert.deepEqual(await setMenuMediaType(itemId, "MODEL", userId), { ok: false, error: "Add the 3D model first." });
    assert.ok((await removeMenuMedia(itemId, "spin", userId)).ok);
    row = await item();
    assert.deepEqual([row.mediaType, row.spinFrames], ["PHOTO", null], "its frames gone: the photo");
    assert.equal((await files(itemId)).filter((f) => f.startsWith("spin-")).length, 0);
    const media = await getMenuMedia(itemId);
    assert.deepEqual([media?.spinFrames, media?.model, !!media?.photo], [null, null, true]);
  });

  test("every change is in the audit log", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { entityType: "Product", entityId: itemId }, select: { action: true } })).map((a) => a.action);
    for (const a of ["menu.media.photo", "menu.media.spin", "menu.media.model", "menu.media.usdz", "menu.media.type", "menu.media.remove"]) assert.ok(actions.includes(a), a);
  });

  test("the item's menu details: allergens, calories, Signature saved with it", async () => {
    const row = await prisma.product.findUniqueOrThrow({ where: { id: itemId }, select: { code: true, name: true, price: true, stationId: true } });
    const raw = { code: row.code, name: row.name, categoryId, price: row.price.toFixed(2), description: "", stationId: "", allergens: ["Fish", "Mustard", "fish"], calories: "520", isSignature: true };
    assert.ok((await updateMenuItem(itemId, menuItemSchema.parse(raw))).ok);
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: itemId }, select: { allergens: true, calories: true, isSignature: true } });
    assert.deepEqual(saved, { allergens: ["Fish", "Mustard"], calories: 520, isSignature: true });
    assert.ok((await updateMenuItem(itemId, menuItemSchema.parse({ ...raw, allergens: [], calories: "", isSignature: false }))).ok);
    assert.deepEqual(await prisma.product.findUniqueOrThrow({ where: { id: itemId }, select: { allergens: true, calories: true, isSignature: true } }), { allergens: null, calories: null, isSignature: false });
  });
});

describe("Module off: the media routes don't exist (database copy)", { skip }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("404 before anything is read", async () => {
    const id = itemId || "x";
    assert.equal((await upload(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ productId: id, kind: "photo" }) })).status, 404);
    assert.equal((await filePreview(new Request("http://localhost/x"), { params: Promise.resolve({ productId: id, file: "photo-x-1200.webp" }) })).status, 404);
  });
});
