import { mkdir, writeFile } from "fs/promises";
import path from "path";

const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function saveAvatarImage(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Profile image must be an image file.");
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("Profile image must be smaller than 5MB.");
  }

  const extension = EXTENSION_BY_MIME[file.type] ?? "jpg";
  const filename = `${userId}-${Date.now()}.${extension}`;

  await mkdir(AVATAR_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(AVATAR_DIR, filename), buffer);

  return `/uploads/avatars/${filename}`;
}
