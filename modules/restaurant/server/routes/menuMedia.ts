import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { MEDIA_FILE } from "../../lib/publicMenu";
import { restaurantModule } from "../../manifest";

// GET /menu/media/<productId>/<file> and /menu/media/logo — the digital
// menu's pictures and 3D models for guests (Part 8). Public, so only: an item that's on
// the menu (not deleted), and a file inside uploads/menu/<productId>/; the
// menu's logo. 404 for anything else, and while the module is off.

// uploads/ at the app's root (backed up with it, Part 6c), as the floor plan images.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const MENU_ROOT = path.join(UPLOADS_ROOT, "menu");
// Images (photos, 360° frames, the logo) and 3D models (GLB; USDZ for iPhone AR).
const LOGO = /^[a-z0-9][a-z0-9._-]{0,80}\.(webp|jpe?g|png)$/i;
const TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  glb: "model/gltf-binary",
  usdz: "model/vnd.usdz+zip",
};
const NOT_FOUND = () => new Response("Not found", { status: 404 });

// A stored path → the file, only if it's inside uploads/menu.
function inMenuRoot(relative: string): string | null {
  const full = path.resolve(UPLOADS_ROOT, relative);
  return full.startsWith(MENU_ROOT + path.sep) ? full : null;
}

async function send(full: string): Promise<Response> {
  try {
    const bytes = await readFile(full);
    const type = TYPES[path.extname(full).slice(1).toLowerCase()];
    if (!type) return NOT_FOUND();
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NOT_FOUND();
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await isModuleEnabled(restaurantModule.id))) return NOT_FOUND();
  const parts = (await params).path;

  if (parts.length === 1 && parts[0] === "logo") {
    const settings = await prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: { logoPath: true } });
    const full = settings?.logoPath ? inMenuRoot(settings.logoPath) : null;
    return full && LOGO.test(path.basename(full)) ? send(full) : NOT_FOUND();
  }

  if (parts.length !== 2) return NOT_FOUND();
  const [productId, file] = parts;
  if (!/^[a-z0-9_-]{1,40}$/i.test(productId) || !MEDIA_FILE.test(file)) return NOT_FOUND();
  const listed = await prisma.product.findFirst({ where: { id: productId, productType: "MENU_ITEM", deletedAt: null, showOnMenu: true }, select: { id: true } });
  if (!listed) return NOT_FOUND();
  const full = inMenuRoot(path.join("menu", productId, file));
  return full ? send(full) : NOT_FOUND();
}
