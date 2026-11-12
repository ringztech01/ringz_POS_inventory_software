import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { Sharp, SharpOptions } from "sharp";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  CONTENT_TYPE,
  EXTENSION,
  FLOOR_IMAGE_MAX_PX,
  fileSlug,
  floorImageName,
  floorImageProblem,
  sniffImage,
  type Calibration,
} from "../../lib/floorImage";
import type { FloorImageAdjustInput } from "../../schemas/floorPlan";

// The floor plan image (Part 7 Step 3). Administrator only — the actions
// check that; these just do the work. Files live under uploads/floor/<areaId>/
// in the project folder (outside public/: the image route serves them to
// people with Manage Floor Plan only), so backing up uploads/ keeps them.
// DiningArea.backgroundImage holds the path under uploads/
// ("floor/<areaId>/<file>"). Every upload, replace, remove and adjustment is
// written to the audit log in the same transaction as the change.

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const FLOOR_ROOT = path.join(UPLOADS_ROOT, "floor");

export type FloorBackground = { url: string; name: string; opacity: number; calibration: Calibration | null };
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// An area id is a cuid; anything else never becomes a folder name.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const areaDir = (areaId: string) => (SAFE_ID.test(areaId) ? path.join(FLOOR_ROOT, areaId) : null);

// The stored path → the file on disk, only if it's inside uploads/floor.
function onDisk(stored: string): string | null {
  const file = path.resolve(UPLOADS_ROOT, stored);
  const rel = path.relative(FLOOR_ROOT, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? file : null;
}

async function removeFile(stored: string | null) {
  const file = stored ? onDisk(stored) : null;
  if (file) await rm(file, { force: true }).catch((error) => console.warn("[restaurant] couldn't remove old floor plan image", file, error));
}

export function backgroundUrl(areaId: string, stored: string): string {
  return `/restaurant/settings/floor/image/${encodeURIComponent(areaId)}?v=${encodeURIComponent(stored.split("/").pop() ?? "")}`;
}

export function toBackground(
  areaId: string,
  row: { backgroundImage: string | null; backgroundOpacity: Prisma.Decimal | number; backgroundScale: Prisma.Decimal | number | null; backgroundOffset: Prisma.JsonValue },
): FloorBackground | null {
  if (!row.backgroundImage) return null;
  const offset = row.backgroundOffset as { x?: unknown; y?: unknown } | null;
  const scale = row.backgroundScale === null ? null : Number(row.backgroundScale);
  const calibration = scale && offset && typeof offset.x === "number" && typeof offset.y === "number" ? { scale, offset: { x: offset.x, y: offset.y } } : null;
  return { url: backgroundUrl(areaId, row.backgroundImage), name: floorImageName(row.backgroundImage), opacity: Number(row.backgroundOpacity), calibration };
}

// sharp, if it loads. It's a native module: when it can't load on this
// machine the upload still works — the original is kept (its type and size
// already checked) and a warning is logged.
type SharpFactory = (input?: Buffer, options?: SharpOptions) => Sharp;
export type SharpLoader = () => Promise<SharpFactory | null>;
export const loadSharp: SharpLoader = async () => {
  try {
    const mod = await import("sharp");
    return mod.default as unknown as SharpFactory;
  } catch (error) {
    console.warn("[restaurant] sharp couldn't load — floor plan images are saved as uploaded, not re-encoded:", error);
    return null;
  }
};

type Prepared = { bytes: Buffer; extension: string; width: number | null; height: number | null; reencoded: boolean };

// WebP, no larger than 2400 px on its long side, turned upright from the
// camera's EXIF. Without sharp: the original bytes as they came.
async function prepare(bytes: Buffer, kind: keyof typeof EXTENSION, load: SharpLoader): Promise<Prepared | { error: string }> {
  const sharp = await load();
  if (!sharp) return { bytes, extension: EXTENSION[kind], width: null, height: null, reencoded: false };
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: FLOOR_IMAGE_MAX_PX, height: FLOOR_IMAGE_MAX_PX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, extension: "webp", width: info.width, height: info.height, reencoded: true };
  } catch (error) {
    console.warn("[restaurant] floor plan image couldn't be read:", error);
    return { error: "That image couldn't be read. Try saving it again as a PNG or JPG." };
  }
}

type BackgroundRow = { backgroundImage: string | null; backgroundOpacity: Prisma.Decimal; backgroundScale: Prisma.Decimal | null; backgroundOffset: Prisma.JsonValue };
type LockedArea = { id: string; name: string; deletedAt: Date | null; backgroundImage: string | null };
const lockArea = async (tx: Prisma.TransactionClient, areaId: string) =>
  (await tx.$queryRaw<LockedArea[]>`SELECT id, name, deletedAt, backgroundImage FROM DiningArea WHERE id = ${areaId} FOR UPDATE`)[0];

// Upload (or replace) an area's floor plan image. Checked first: PNG, JPG
// or WebP by its actual bytes, 8 MB at most. A new image clears the old
// calibration (it was for the old image); the opacity stays.
export async function storeFloorImage(
  input: { areaId: string; userId: string; file: { name: string; type: string; size: number; bytes: Buffer } },
  load: SharpLoader = loadSharp,
): Promise<Result<{ background: FloorBackground; replaced: boolean }>> {
  const { areaId, userId, file } = input;
  const problem = floorImageProblem(file);
  if (problem) return { ok: false, error: problem };
  const kind = sniffImage(file.bytes);
  if (!kind) return { ok: false, error: "Use a PNG, JPG or WebP image." };
  const dir = areaDir(areaId);
  const area = dir ? await prisma.diningArea.findFirst({ where: { id: areaId, deletedAt: null }, select: { id: true } }) : null;
  if (!dir || !area) return { ok: false, error: "That dining area has been deleted. Reload the floor plan." };

  const prepared = await prepare(file.bytes, kind, load);
  if ("error" in prepared) return { ok: false, error: prepared.error };
  await mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${fileSlug(file.name)}.${prepared.extension}`;
  const stored = `floor/${areaId}/${filename}`;
  await writeFile(path.join(dir, filename), prepared.bytes);

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const locked = await lockArea(tx, areaId);
      if (!locked || locked.deletedAt) return null;
      const previous = locked.backgroundImage;
      const updated = await tx.diningArea.update({
        where: { id: areaId },
        data: { backgroundImage: stored, backgroundScale: null, backgroundOffset: Prisma.DbNull },
        select: { backgroundImage: true, backgroundOpacity: true, backgroundScale: true, backgroundOffset: true },
      });
      await writeAudit(
        {
          userId,
          action: previous ? "floor.background.replace" : "floor.background.upload",
          entityType: "DiningArea",
          entityId: areaId,
          meta: {
            area: locked.name,
            file: stored,
            original: file.name.slice(0, 200),
            originalBytes: file.size,
            bytes: prepared.bytes.length,
            width: prepared.width,
            height: prepared.height,
            reencoded: prepared.reencoded,
            ...(previous ? { previous } : {}),
          },
        },
        tx,
      );
      return { row: updated, previous };
    });
    if (!saved) {
      await removeFile(stored);
      return { ok: false, error: "That dining area has been deleted. Reload the floor plan." };
    }
    if (saved.previous && saved.previous !== stored) await removeFile(saved.previous);
    return { ok: true, background: toBackground(areaId, saved.row)!, replaced: !!saved.previous };
  } catch (error) {
    await removeFile(stored);
    throw error;
  }
}

// Remove an area's floor plan image (and its calibration).
export async function removeFloorImage(input: { areaId: string; userId: string }): Promise<Result<object>> {
  const removed = await prisma.$transaction(async (tx): Promise<{ error: string } | { file: string }> => {
    const locked = await lockArea(tx, input.areaId);
    if (!locked || locked.deletedAt) return { error: "That dining area has been deleted. Reload the floor plan." };
    if (!locked.backgroundImage) return { error: "There's no floor plan image to remove." };
    await tx.diningArea.update({ where: { id: input.areaId }, data: { backgroundImage: null, backgroundScale: null, backgroundOffset: Prisma.DbNull } });
    await writeAudit({ userId: input.userId, action: "floor.background.remove", entityType: "DiningArea", entityId: input.areaId, meta: { area: locked.name, file: locked.backgroundImage } }, tx);
    return { file: locked.backgroundImage };
  });
  if ("error" in removed) return { ok: false, error: removed.error };
  await removeFile(removed.file);
  return { ok: true };
}

// Its opacity while tracing, and/or its calibration (null: back to "as
// large as fits").
export async function adjustFloorImage(input: FloorImageAdjustInput & { userId: string }): Promise<Result<{ background: FloorBackground }>> {
  const result = await prisma.$transaction(async (tx): Promise<{ error: string } | { row: BackgroundRow }> => {
    const locked = await lockArea(tx, input.areaId);
    if (!locked || locked.deletedAt) return { error: "That dining area has been deleted. Reload the floor plan." };
    if (!locked.backgroundImage) return { error: "Upload a floor plan image first." };
    const before = await tx.diningArea.findUniqueOrThrow({ where: { id: input.areaId }, select: { backgroundOpacity: true, backgroundScale: true, backgroundOffset: true } });
    const data: Prisma.DiningAreaUpdateInput = {};
    if (input.opacity !== undefined) data.backgroundOpacity = Math.round(input.opacity * 100) / 100;
    if (input.calibration !== undefined) {
      data.backgroundScale = input.calibration?.scale ?? null;
      data.backgroundOffset = input.calibration ? input.calibration.offset : Prisma.DbNull;
    }
    const row = await tx.diningArea.update({
      where: { id: input.areaId },
      data,
      select: { backgroundImage: true, backgroundOpacity: true, backgroundScale: true, backgroundOffset: true },
    });
    const action = input.calibration === undefined ? "floor.background.opacity" : input.calibration ? "floor.background.calibrate" : "floor.background.uncalibrate";
    await writeAudit(
      {
        userId: input.userId,
        action,
        entityType: "DiningArea",
        entityId: input.areaId,
        meta: {
          area: locked.name,
          file: locked.backgroundImage,
          ...(input.opacity !== undefined ? { opacity: { from: Number(before.backgroundOpacity), to: Number(row.backgroundOpacity) } } : {}),
          ...(input.calibration !== undefined
            ? { calibration: { from: before.backgroundScale === null ? null : { scale: Number(before.backgroundScale), offset: before.backgroundOffset }, to: input.calibration } }
            : {}),
        },
      },
      tx,
    );
    return { row };
  });
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, background: toBackground(input.areaId, result.row)! };
}

// For the image route: the area's current image, if it has one on disk.
export async function readFloorImage(areaId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const area = await prisma.diningArea.findFirst({ where: { id: areaId, deletedAt: null }, select: { backgroundImage: true } });
  const file = area?.backgroundImage ? onDisk(area.backgroundImage) : null;
  if (!file) return null;
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return null;
  return { bytes, contentType: CONTENT_TYPE[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream" };
}
