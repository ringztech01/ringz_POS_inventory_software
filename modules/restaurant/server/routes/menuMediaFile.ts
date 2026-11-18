import "server-only";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { guardRoute } from "../guard";
import { readMenuMediaFile } from "../services/menuMedia";

// GET /restaurant/food/media/<productId>/file/<file> — a menu item's photo,
// 360° frame or 3D model for Food › Menu items' preview (Part 8 Step 5): any
// menu item, on the menu or not. Needs Manage Food; 404 while the module is
// off. Guests get theirs from /menu/media/… (items on the menu only).
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string; file: string }> }) {
  const denied = await guardRoute(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;
  const { productId, file } = await params;
  const found = await readMenuMediaFile(productId, file);
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(found.bytes), { headers: { "Content-Type": found.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
