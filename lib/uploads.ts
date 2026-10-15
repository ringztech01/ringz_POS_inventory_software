import { mkdir, writeFile } from "fs/promises";
import path from "path";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function saveImage(
  file: File,
  dir: string,
  idForFilename: string,
  invalidTypeMessage: string,
  tooLargeMessage: string,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(invalidTypeMessage);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(tooLargeMessage);
  }

  const extension = EXTENSION_BY_MIME[file.type] ?? "jpg";
  const filename = `${idForFilename}-${Date.now()}.${extension}`;

  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return filename;
}

const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

export async function saveAvatarImage(file: File, userId: string): Promise<string> {
  const filename = await saveImage(
    file,
    AVATAR_DIR,
    userId,
    "Profile image must be an image file.",
    "Profile image must be smaller than 5MB.",
  );

  return `/uploads/avatars/${filename}`;
}

const CATEGORY_LOGO_DIR = path.join(process.cwd(), "public", "uploads", "categories");

export async function saveCategoryLogo(file: File, idForFilename: string): Promise<string> {
  const filename = await saveImage(
    file,
    CATEGORY_LOGO_DIR,
    idForFilename,
    "Category logo must be an image file.",
    "Category logo must be smaller than 5MB.",
  );

  return `/uploads/categories/${filename}`;
}

const BRAND_LOGO_DIR = path.join(process.cwd(), "public", "uploads", "brands");

export async function saveBrandLogo(file: File, idForFilename: string): Promise<string> {
  const filename = await saveImage(
    file,
    BRAND_LOGO_DIR,
    idForFilename,
    "Brand logo must be an image file.",
    "Brand logo must be smaller than 5MB.",
  );

  return `/uploads/brands/${filename}`;
}

const PRODUCT_IMAGE_DIR = path.join(process.cwd(), "public", "uploads", "products");

// index disambiguates filenames when several images for the same product are
// saved back-to-back — Date.now() alone can collide within the same batch.
export async function saveProductImage(file: File, idForFilename: string, index: number): Promise<string> {
  const filename = await saveImage(
    file,
    PRODUCT_IMAGE_DIR,
    `${idForFilename}-${index}`,
    "Product image must be an image file.",
    "Product image must be smaller than 5MB.",
  );

  return `/uploads/products/${filename}`;
}
