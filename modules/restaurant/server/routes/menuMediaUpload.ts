import "server-only";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { guardRoute } from "../guard";
import { addSpinFrame, cancelSpin, finishSpin, saveMenuModel, saveMenuPhoto, saveMenuUsdz, spinFromVideo, startSpin } from "../services/menuMedia";

// POST /restaurant/food/media/<productId>/<kind> — a menu item's media
// (Part 8 Step 5), from Food › Menu items. Needs Manage Food (404 while the
// module is off). Kinds:
//   photo · spin-start · spin-frame?session=… · spin-finish?session=… ·
//   spin-cancel?session=… · spin-video · model (GLB) · usdz
// The file comes as multipart "file"; each kind checks its type (by its
// bytes) and size. Answers { ok, … } as JSON, never throws.
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function fileFrom(request: Request): Promise<{ name: string; size: number; bytes: Buffer } | null> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return null;
    return { name: file.name || "file", size: file.size, bytes: Buffer.from(await file.arrayBuffer()) };
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string; kind: string }> }) {
  const denied = await guardRoute(RESTAURANT_PERMISSIONS.MANAGE_FOOD);
  if (denied) return denied;
  const { userId } = await getCurrentUserPermissions();
  if (!userId) return json({ ok: false, error: "You must be signed in to do that." }, 401);
  const { productId, kind } = await params;
  const session = new URL(request.url).searchParams.get("session") ?? "";
  try {
    switch (kind) {
      case "spin-start":
        return json(await startSpin(productId));
      case "spin-finish":
        return json(await finishSpin(productId, session, userId));
      case "spin-cancel":
        await cancelSpin(productId, session);
        return json({ ok: true });
      case "photo":
      case "spin-frame":
      case "spin-video":
      case "model":
      case "usdz": {
        const file = await fileFrom(request);
        if (!file) return json({ ok: false, error: "No file came with that upload. Try again." }, 400);
        if (kind === "photo") return json(await saveMenuPhoto(productId, userId, file));
        if (kind === "spin-frame") return json(await addSpinFrame(productId, session, file));
        if (kind === "spin-video") return json(await spinFromVideo(productId, userId, file));
        if (kind === "model") return json(await saveMenuModel(productId, userId, file));
        return json(await saveMenuUsdz(productId, userId, file));
      }
      default:
        return json({ ok: false, error: "Not found" }, 404);
    }
  } catch (error) {
    console.error(`[restaurant] menu media upload (${kind}) failed:`, error);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
