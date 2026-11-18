import "server-only";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  FRAME_PX,
  MEDIA_LIMITS,
  MODEL_TARGET_BYTES,
  PHOTO_PX,
  SESSION,
  SPIN_MAX,
  THUMB_PX,
  VIDEO_FRAMES,
  formatBytes,
  frameName,
  frameOrder,
  isGlb,
  isUsdz,
  modelName,
  photoNames,
  sizeProblem,
  sniffImage,
  sniffVideo,
  spinCountProblem,
  usableType,
  type MenuMediaKind,
  type MenuMediaType,
} from "../../lib/menuMediaRules";

// A menu item's photo, 360° frames and 3D model (Part 8 Step 5): stored
// under uploads/menu/<productId>/ (backed up with uploads/, Part 6c), the
// item's columns pointing at them. The route and actions check who's asking;
// these check the files and do the work. Each change is in the audit log.

const run = promisify(execFile);
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const MENU_ROOT = path.join(UPLOADS_ROOT, "menu");
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type MediaResult = { ok: true; media: MenuMediaView; notice?: string } | { ok: false; error: string };

// What Food › Menu items shows of an item's media (the back office's own
// file URLs: an item needn't be on the menu to be set up).
export type MenuMediaView = {
  mediaType: MenuMediaType;
  photo: { full: string; thumb: string } | null;
  spinFrames: string[] | null;
  model: { glb: string; size: number; usdz: string | null; usdzSize: number | null } | null;
};

const fileUrl = (productId: string, stored: string) => `/restaurant/food/media/${encodeURIComponent(productId)}/file/${encodeURIComponent(stored.split("/").pop() ?? "")}`;
const itemDir = (productId: string) => (SAFE_ID.test(productId) ? path.join(MENU_ROOT, productId) : null);
const stored = (productId: string, file: string) => `menu/${productId}/${file}`;
const stamp = () => Date.now().toString(36) + randomBytes(2).toString("hex");

// The stored path → its file, only if it's inside uploads/menu/<productId>/.
export function mediaOnDisk(productId: string, storedPath: string | null | undefined): string | null {
  const dir = itemDir(productId);
  if (!dir || !storedPath) return null;
  const file = path.resolve(UPLOADS_ROOT, storedPath);
  const rel = path.relative(dir, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.includes(path.sep) ? file : null;
}

async function removeStored(productId: string, paths: readonly (string | null | undefined)[]) {
  for (const p of paths) {
    const file = mediaOnDisk(productId, p);
    if (file) await rm(file, { force: true }).catch((error) => console.warn("[restaurant] couldn't remove old menu media", file, error));
  }
}

const sizeOf = (file: string | null) => (file ? stat(file).then((s) => s.size, () => null) : Promise.resolve(null));
const framesOf = (value: Prisma.JsonValue | null): string[] => (Array.isArray(value) ? value.filter((f): f is string => typeof f === "string") : []);

type ItemMedia = { id: string; mediaType: MenuMediaType; photoPath: string | null; spinFrames: Prisma.JsonValue | null; modelGlbPath: string | null; modelUsdzPath: string | null };
const MEDIA_SELECT = { id: true, mediaType: true, photoPath: true, spinFrames: true, modelGlbPath: true, modelUsdzPath: true } as const;
const findItem = (productId: string) => (SAFE_ID.test(productId) ? prisma.product.findFirst({ where: { id: productId, productType: "MENU_ITEM", deletedAt: null }, select: MEDIA_SELECT }) : Promise.resolve(null));
const GONE = { ok: false as const, error: "That menu item has been deleted. Reload the list." };

export async function menuMediaView(item: ItemMedia): Promise<MenuMediaView> {
  const frames = framesOf(item.spinFrames);
  const glbFile = mediaOnDisk(item.id, item.modelGlbPath);
  const usdzFile = mediaOnDisk(item.id, item.modelUsdzPath);
  const [glbSize, usdzSize] = await Promise.all([sizeOf(glbFile), sizeOf(usdzFile)]);
  return {
    mediaType: item.mediaType,
    photo: item.photoPath ? { full: fileUrl(item.id, item.photoPath), thumb: fileUrl(item.id, item.photoPath.replace(/-1200\.webp$/, "-400.webp")) } : null,
    spinFrames: frames.length ? frames.map((f) => fileUrl(item.id, f)) : null,
    model: item.modelGlbPath && glbSize !== null ? { glb: fileUrl(item.id, item.modelGlbPath), size: glbSize, usdz: item.modelUsdzPath && usdzSize !== null ? fileUrl(item.id, item.modelUsdzPath) : null, usdzSize } : null,
  };
}

export async function getMenuMedia(productId: string): Promise<MenuMediaView | null> {
  const item = await findItem(productId);
  return item ? menuMediaView(item) : null;
}

// Writes the item's new media columns (keeping its chosen type only if
// that type still has its files), logs it, and removes the files they replace.
async function commit(productId: string, userId: string, data: Prisma.ProductUpdateInput, replaced: (string | null | undefined)[], audit: { action: string; meta?: Prisma.InputJsonValue }): Promise<MediaResult> {
  const saved = await prisma.$transaction(async (tx) => {
    const locked = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM Product WHERE id = ${productId} AND deletedAt IS NULL FOR UPDATE`)[0];
    if (!locked) return null;
    const updated = await tx.product.update({ where: { id: productId }, data, select: MEDIA_SELECT });
    const type = usableType(updated.mediaType, { spin: framesOf(updated.spinFrames).length > 0, model: !!updated.modelGlbPath });
    const item = type === updated.mediaType ? updated : await tx.product.update({ where: { id: productId }, data: { mediaType: type }, select: MEDIA_SELECT });
    await writeAudit({ userId, action: audit.action, entityType: "Product", entityId: productId, meta: audit.meta }, tx);
    return item;
  });
  if (!saved) return GONE;
  const keep = new Set([saved.photoPath, saved.photoPath?.replace(/-1200\.webp$/, "-400.webp"), saved.modelGlbPath, saved.modelUsdzPath, ...framesOf(saved.spinFrames)]);
  await removeStored(productId, replaced.filter((p) => p && !keep.has(p)));
  return { ok: true, media: await menuMediaView(saved) };
}

async function loadSharp() {
  return (await import("sharp")).default;
}

// ---------------------------------------------------------------- photo

export async function saveMenuPhoto(productId: string, userId: string, file: { size: number; bytes: Buffer }): Promise<MediaResult> {
  if (file.size > MEDIA_LIMITS.photo) return { ok: false, error: `That photo is ${formatBytes(file.size)}; ${formatBytes(MEDIA_LIMITS.photo)} at most.` };
  if (!sniffImage(file.bytes)) return { ok: false, error: "Use a JPG, PNG or WebP photo." };
  const item = await findItem(productId);
  const dir = itemDir(productId);
  if (!item || !dir) return GONE;
  const sharp = await loadSharp();
  const names = photoNames(stamp());
  try {
    await mkdir(dir, { recursive: true });
    const upright = sharp(file.bytes, { limitInputPixels: 120_000_000 }).rotate();
    await upright.clone().resize({ width: PHOTO_PX, height: PHOTO_PX, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, names.full));
    await upright.clone().resize({ width: THUMB_PX, height: THUMB_PX, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(dir, names.thumb));
  } catch (error) {
    console.warn("[restaurant] menu photo couldn't be read:", error);
    await removeStored(productId, [stored(productId, names.full), stored(productId, names.thumb)]);
    return { ok: false, error: "That photo couldn't be read. Try saving it again as a JPG or PNG." };
  }
  const old = item.photoPath;
  return commit(productId, userId, { photoPath: stored(productId, names.full) }, [old, old?.replace(/-1200\.webp$/, "-400.webp")], { action: "menu.media.photo" });
}

// ---------------------------------------------------------------- 360°

// A 360° from images arrives a frame at a time (each can be large), into a
// staging folder; Finish checks and publishes them together.
const stagingDir = (productId: string, session: string) => (itemDir(productId) && SESSION.test(session) ? path.join(itemDir(productId)!, `.spin-${session}`) : null);
type Staged = { name: string; file: string; width: number; height: number };

export async function startSpin(productId: string): Promise<{ ok: true; session: string } | { ok: false; error: string }> {
  const item = await findItem(productId);
  const dir = itemDir(productId);
  if (!item || !dir) return GONE;
  await mkdir(dir, { recursive: true });
  // Any upload left half-done goes.
  for (const entry of await readdir(dir).catch(() => [])) if (entry.startsWith(".spin-")) await rm(path.join(dir, entry), { recursive: true, force: true });
  const session = randomBytes(8).toString("hex");
  await mkdir(stagingDir(productId, session)!, { recursive: true });
  return { ok: true, session };
}

async function stagedFrames(dir: string): Promise<Staged[]> {
  const text = await readFile(path.join(dir, "frames.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Staged);
}

export async function addSpinFrame(productId: string, session: string, file: { name: string; size: number; bytes: Buffer }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const dir = stagingDir(productId, session);
  if (!dir || !(await stat(dir).then((s) => s.isDirectory(), () => false))) return { ok: false, error: "That upload has expired. Start the 360° again." };
  if (file.size > MEDIA_LIMITS.frame) return { ok: false, error: `“${file.name}” is ${formatBytes(file.size)}; ${formatBytes(MEDIA_LIMITS.frame)} at most.` };
  if (!sniffImage(file.bytes)) return { ok: false, error: `“${file.name}” isn't a JPG, PNG or WebP image.` };
  const count = (await stagedFrames(dir)).length;
  if (count >= SPIN_MAX) return { ok: false, error: `A 360° takes at most ${SPIN_MAX} frames.` };
  const sharp = await loadSharp();
  try {
    const upright = sharp(file.bytes, { limitInputPixels: 120_000_000 }).rotate();
    const meta = await upright.clone().metadata();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = (turned ? meta.height : meta.width) ?? 0;
    const height = (turned ? meta.width : meta.height) ?? 0;
    const staged = `${String(count).padStart(3, "0")}.webp`;
    await upright.resize({ width: FRAME_PX, height: FRAME_PX, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(dir, staged));
    await appendFile(path.join(dir, "frames.jsonl"), JSON.stringify({ name: file.name.slice(0, 200), file: staged, width, height } satisfies Staged) + "\n");
    return { ok: true, count: count + 1 };
  } catch (error) {
    console.warn("[restaurant] a 360° frame couldn't be read:", error);
    return { ok: false, error: `“${file.name}” couldn't be read. Try saving it again as a JPG or PNG.` };
  }
}

// Publishes the staged frames in order (by name), once they're 24–36 and
// all the same size.
async function publishFrames(productId: string, userId: string, dir: string, frames: Staged[], source: "images" | "video", checkSizes: boolean): Promise<MediaResult> {
  const problem = spinCountProblem(frames.length) ?? (checkSizes ? sizeProblem(frames) : null);
  if (problem) return { ok: false, error: problem };
  const order = frameOrder(frames.map((f) => f.name));
  if (!order.ok) return order;
  const item = await findItem(productId);
  const itemFolder = itemDir(productId);
  if (!item || !itemFolder) return GONE;
  const s = stamp();
  const published: string[] = [];
  for (const [i, index] of order.order.entries()) {
    const name = frameName(s, i);
    await rename(path.join(dir, frames[index].file), path.join(itemFolder, name));
    published.push(stored(productId, name));
  }
  const result = await commit(productId, userId, { spinFrames: published }, framesOf(item.spinFrames), { action: "menu.media.spin", meta: { frames: published.length, from: source } });
  if (!result.ok) await removeStored(productId, published);
  return result;
}

export async function finishSpin(productId: string, session: string, userId: string): Promise<MediaResult> {
  const dir = stagingDir(productId, session);
  if (!dir || !(await stat(dir).then((s) => s.isDirectory(), () => false))) return { ok: false, error: "That upload has expired. Start the 360° again." };
  try {
    return await publishFrames(productId, userId, dir, await stagedFrames(dir), "images", true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function cancelSpin(productId: string, session: string): Promise<void> {
  const dir = stagingDir(productId, session);
  if (dir) await rm(dir, { recursive: true, force: true });
}

// ffmpeg, if this server has it (it's on the PATH).
let ffmpegChecked: Promise<boolean> | null = null;
export function hasFfmpeg(): Promise<boolean> {
  ffmpegChecked ??= run("ffmpeg", ["-version"], { windowsHide: true, timeout: 15_000 }).then(
    () => true,
    () => false,
  );
  return ffmpegChecked;
}

// A 360° from one short video: 36 frames taken evenly through it, on this
// server (ffmpeg).
export async function spinFromVideo(productId: string, userId: string, file: { name: string; size: number; bytes: Buffer }): Promise<MediaResult> {
  if (file.size > MEDIA_LIMITS.video) return { ok: false, error: `That video is ${formatBytes(file.size)}; ${formatBytes(MEDIA_LIMITS.video)} at most. Trim it to a few seconds.` };
  const kind = sniffVideo(file.bytes);
  if (!kind) return { ok: false, error: "Use an MP4, MOV or WebM video." };
  if (!(await hasFfmpeg())) return { ok: false, error: "This server can't take frames from a video (ffmpeg isn't installed). Upload the frames as images instead." };
  const started = await startSpin(productId);
  if (!started.ok) return started;
  const dir = stagingDir(productId, started.session)!;
  const input = path.join(dir, `video.${kind}`);
  try {
    await writeFile(input, file.bytes);
    // How long it is, from ffmpeg's own report.
    const probe = await run("ffmpeg", ["-hide_banner", "-i", input], { windowsHide: true, timeout: 30_000 }).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
    const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
    const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!(seconds > 0)) return { ok: false, error: "That video couldn't be read." };
    if (seconds > 60) return { ok: false, error: `That video is ${Math.round(seconds)} s long; use one of a minute at most (one slow turn).` };
    await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", `fps=${VIDEO_FRAMES}/${seconds.toFixed(3)},scale='min(${FRAME_PX},iw)':-2`, "-frames:v", String(VIDEO_FRAMES), path.join(dir, "v%02d.png")],
      { windowsHide: true, timeout: 120_000 },
    );
    const pngs = (await readdir(dir)).filter((f) => /^v\d+\.png$/.test(f)).sort();
    const sharp = await loadSharp();
    const frames: Staged[] = [];
    for (const [i, png] of pngs.entries()) {
      const out = `${String(i).padStart(3, "0")}.webp`;
      // From memory, not by path: sharp keeps a file it opened locked on Windows,
      // and the staging folder is removed straight after.
      const info = await sharp(await readFile(path.join(dir, png))).webp({ quality: 80 }).toFile(path.join(dir, out));
      frames.push({ name: png, file: out, width: info.width, height: info.height });
    }
    return await publishFrames(productId, userId, dir, frames, "video", false);
  } catch (error) {
    console.warn("[restaurant] frames couldn't be taken from a video:", error);
    return { ok: false, error: "Frames couldn't be taken from that video. Try another, or upload the frames as images." };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- 3D

// Meshopt for the geometry (the menu's viewer decodes it with nothing
// extra), WebP textures; a second, smaller pass if it's still over the
// 3 MB target. Never bigger than it came.
export async function compressGlb(bytes: Uint8Array): Promise<{ bytes: Uint8Array; compressed: boolean; note?: string }> {
  try {
    const [{ NodeIO }, { ALL_EXTENSIONS }, fn, { MeshoptEncoder, MeshoptDecoder }, sharp] = await Promise.all([
      import("@gltf-transform/core"),
      import("@gltf-transform/extensions"),
      import("@gltf-transform/functions"),
      import("meshoptimizer"),
      loadSharp(),
    ]);
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
    const pass = async (texturePx: number) => {
      const doc = await io.readBinary(bytes);
      await doc.transform(fn.dedup(), fn.prune(), fn.weld(), fn.textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texturePx, texturePx] }), fn.meshopt({ encoder: MeshoptEncoder, level: "medium" }));
      return io.writeBinary(doc);
    };
    let best = await pass(2048);
    if (best.byteLength > MODEL_TARGET_BYTES) {
      const smaller = await pass(1024);
      if (smaller.byteLength < best.byteLength) best = smaller;
    }
    if (best.byteLength >= bytes.byteLength) return { bytes, compressed: false, note: "Compressing didn't make it any smaller, so the original is kept." };
    return { bytes: best, compressed: true };
  } catch (error) {
    console.warn("[restaurant] a 3D model couldn't be compressed:", error);
    return { bytes, compressed: false, note: "This model couldn't be compressed here, so the original is kept." };
  }
}

export async function saveMenuModel(productId: string, userId: string, file: { size: number; bytes: Buffer }): Promise<MediaResult> {
  if (file.size > MEDIA_LIMITS.model) return { ok: false, error: `That model is ${formatBytes(file.size)}; ${formatBytes(MEDIA_LIMITS.model)} at most.` };
  if (!isGlb(file.bytes)) return { ok: false, error: "Use a GLB file (binary glTF 2.0)." };
  const item = await findItem(productId);
  const dir = itemDir(productId);
  if (!item || !dir) return GONE;
  const result = await compressGlb(new Uint8Array(file.bytes));
  const name = modelName(stamp(), "glb");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), result.bytes);
  const size = result.bytes.byteLength;
  const notes = [
    result.compressed ? `Compressed from ${formatBytes(file.size)} to ${formatBytes(size)}.` : result.note,
    size > MODEL_TARGET_BYTES ? `It's ${formatBytes(size)}, above the ${formatBytes(MODEL_TARGET_BYTES)} target: it may be slow to open on a phone.` : null,
  ].filter(Boolean);
  const saved = await commit(productId, userId, { modelGlbPath: stored(productId, name) }, [item.modelGlbPath], { action: "menu.media.model", meta: { uploaded: file.size, stored: size, compressed: result.compressed } });
  if (!saved.ok) await removeStored(productId, [stored(productId, name)]);
  return saved.ok ? { ...saved, notice: notes.join(" ") || undefined } : saved;
}

export async function saveMenuUsdz(productId: string, userId: string, file: { size: number; bytes: Buffer }): Promise<MediaResult> {
  if (file.size > MEDIA_LIMITS.usdz) return { ok: false, error: `That USDZ is ${formatBytes(file.size)}; ${formatBytes(MEDIA_LIMITS.usdz)} at most.` };
  if (!isUsdz(file.bytes)) return { ok: false, error: "Use a USDZ file (for iPhone's View on your table)." };
  const item = await findItem(productId);
  const dir = itemDir(productId);
  if (!item || !dir) return GONE;
  if (!item.modelGlbPath) return { ok: false, error: "Add the GLB model first; the USDZ goes with it." };
  const name = modelName(stamp(), "usdz");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), file.bytes);
  const saved = await commit(productId, userId, { modelUsdzPath: stored(productId, name) }, [item.modelUsdzPath], { action: "menu.media.usdz", meta: { size: file.size } });
  if (!saved.ok) await removeStored(productId, [stored(productId, name)]);
  return saved;
}

// ---------------------------------------------------------------- remove, choose

export async function removeMenuMedia(productId: string, kind: MenuMediaKind, userId: string): Promise<MediaResult> {
  const item = await findItem(productId);
  if (!item) return GONE;
  const data: Prisma.ProductUpdateInput =
    kind === "photo" ? { photoPath: null } : kind === "spin" ? { spinFrames: Prisma.DbNull } : kind === "model" ? { modelGlbPath: null, modelUsdzPath: null } : { modelUsdzPath: null };
  const files =
    kind === "photo" ? [item.photoPath, item.photoPath?.replace(/-1200\.webp$/, "-400.webp")] : kind === "spin" ? framesOf(item.spinFrames) : kind === "model" ? [item.modelGlbPath, item.modelUsdzPath] : [item.modelUsdzPath];
  return commit(productId, userId, data, files, { action: "menu.media.remove", meta: { kind } });
}

export async function setMenuMediaType(productId: string, type: MenuMediaType, userId: string): Promise<MediaResult> {
  const item = await findItem(productId);
  if (!item) return GONE;
  if (type === "SPIN" && !framesOf(item.spinFrames).length) return { ok: false, error: "Add the 360° frames first." };
  if (type === "MODEL" && !item.modelGlbPath) return { ok: false, error: "Add the 3D model first." };
  if (item.mediaType === type) return { ok: true, media: await menuMediaView(item) };
  return commit(productId, userId, { mediaType: type }, [], { action: "menu.media.type", meta: { from: item.mediaType, to: type } });
}

// A stored file of the item, for the back office's preview (any item, on
// the menu or not): its bytes and type, or null.
export async function readMenuMediaFile(productId: string, file: string): Promise<{ bytes: Buffer; type: string } | null> {
  const full = mediaOnDisk(productId, stored(productId, file));
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { webp: "image/webp", glb: "model/gltf-binary", usdz: "model/vnd.usdz+zip" }[ext];
  if (!full || !type || file.startsWith(".")) return null;
  const item = await findItem(productId);
  if (!item) return null;
  return readFile(full).then(
    (bytes) => ({ bytes, type }),
    () => null,
  );
}
